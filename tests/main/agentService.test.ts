import { afterEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Options, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { AgentService } from '@main/agent/service';
import { TimelineService } from '@main/timeline/service';
import { atomicJson } from '@main/fs/managed';
import { emptyTimeline } from '@main/projects/service';
import { defaultGlobalSettings } from '@shared/schema/settings';
import type { AgentEvent } from '@shared/schema/agent';
import type { WorkflowRuntime } from '@main/projects/runtime';
import type { MediaService } from '@main/media/service';
import type { ExtensionSecretStore } from '@main/secrets/keychain';

type Sdk = typeof import('@anthropic-ai/claude-agent-sdk');
interface Tool { name: string; handler: (input: Record<string, unknown>) => Promise<unknown> }
const roots: string[] = []; const agents: AgentService[] = [];
afterEach(async () => { await Promise.all(agents.splice(0).map((agent) => agent.close())); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function setup(enabled: string[] = ['cutroom']) {
  const root = await mkdtemp(path.join(process.env.TMPDIR ?? tmpdir(), 'cutroom-agent-test-')); roots.push(root); const settings = defaultGlobalSettings(); settings.snapshots.autoBeforeAgent = false;
  const doc = emptyTimeline({ aspect: '16:9', width: 320, height: 180, fps: 30 }); await atomicJson(root, 'timeline.json', doc);
  const timeline = await TimelineService.load(root, { onChanged: (change) => agent.record(change) }); const events: AgentEvent[] = []; const servers = new Map<string, Tool[]>(); const inbox: SDKMessage[] = []; let options!: Options; let stop: (() => void) | undefined; let downloads = 0;
  let prompt: AsyncIterable<SDKUserMessage>;
  const skill = { id: 'podcast-clip', name: 'Podcast clip', description: 'Reusable conversation', instructions: 'Keep the exchange faithful and captions readable.', source: 'builtin' as const, compositions: [] as string[], updatedAt: new Date().toISOString() };
  const saveSkill = vi.fn(async () => skill); const readSkill = vi.fn(async () => skill);
  const applySkill = vi.fn(async (_id: string, template: string, name: string) => ({ name, engine: 'hyperframes', path: `compositions/${template}`, durationSec: 5 }));
  const sdk = { tool: (name: string, _description: string, _shape: unknown, handler: Tool['handler']) => ({ name, handler }), createSdkMcpServer: (input: { name: string; tools: Tool[] }) => { servers.set(input.name, input.tools); return { type: 'sdk', name: input.name, instance: {} }; }, query: (input: { options: Options; prompt: AsyncIterable<SDKUserMessage> }) => {
    options = input.options; prompt = input.prompt; let closed = false; let wake: (() => void) | undefined;
    return { async *[Symbol.asyncIterator]() { while (!closed) { const message = inbox.shift(); if (message) yield message; else await new Promise<void>((resolve) => { wake = resolve; stop = resolve; }); } }, close: () => { closed = true; wake?.(); }, interrupt: async () => {}, mcpServerStatus: async () => [] };
  } } as unknown as Sdk;
  const project = { rootPath: root, project: { id: 'project' } };
  const runtime = { compositions: { createFromSkill: applySkill }, skills: { get: readSkill, save: saveSkill, list: async () => [skill] }, projects: { require: () => project, current: () => project }, timeline: () => timeline, settings: { get: () => settings }, extensions: { enabled: (id: string) => enabled.includes(id), validate: () => ({}) }, codex: { status: async () => ({ available: false, loggedIn: false, mode: null }) }, urls: { download: async () => { downloads++; return { jobId: 'download' }; } } } as unknown as WorkflowRuntime;
  const agent = new AgentService({ runtime, media: {} as MediaService, secrets: { getExtension: async () => null } as unknown as ExtensionSecretStore, sdk: async () => sdk, env: async () => ({ PATH: '/fixed' }), binary: async () => ({ path: '/fixed/claude' }), emit: (event) => events.push(event) }); agents.push(agent);
  return { root, settings, agent, timeline, events, servers, saveSkill, readSkill, applySkill, nextPrompt: () => prompt[Symbol.asyncIterator]().next(), options: () => options, downloads: () => downloads, inject: (...messages: unknown[]) => { inbox.push(...messages as SDKMessage[]); stop?.(); } };
}
it('builds scoped SDK options and attributes MCP edits to the active request with live review', async () => {
  const env = await setup(['cutroom', 'codex', 'elevenlabs']); const started = await env.agent.start({ mode: 'edit' }); await env.agent.send({ sessionId: started.sessionId, text: 'Add a three second clip from raw media to the video track without captions' });
  const options = env.options(); expect(options.cwd).toBe(env.root); expect(options.settingSources).toEqual([]); expect(options.includePartialMessages).toBe(true); expect(options.disallowedTools).toEqual(expect.arrayContaining(['Bash', 'WebFetch', 'WebSearch'])); expect(options.mcpServers).not.toHaveProperty('codex'); expect(options.mcpServers).not.toHaveProperty('elevenlabs');
  const tool = env.servers.get('cutroom')!.find((tool) => tool.name === 'timeline_apply')!; const result = await tool.handler({ ops: [{ type: 'addItem', trackId: 'video', item: { type: 'clip', id: 'clip_abcdefghij', src: 'raw/clip.mp4', start: 0, duration: 3, in: 0, out: 3, speed: 1, volume: 1, muted: false, createdBy: `agent:${started.sessionId}`, userEdited: [] } }], label: 'Add clip', baseRevision: 0 }); expect(result).not.toHaveProperty('isError', true);
  const history = JSON.parse((await readFile(path.join(env.root, '.cutroom/history.jsonl'), 'utf8')).trim()); expect(history.actor).toBe('agent'); expect(history.requestId).toBeTruthy(); expect(env.events).toContainEqual(expect.objectContaining({ type: 'change', requestId: history.requestId, itemId: 'clip_abcdefghij' }));
  const revision = env.timeline.state().revision; env.agent.review.keep(history.requestId); expect(env.timeline.state().revision).toBe(revision);
});
it('streams deltas, final assistant messages and correlated tool completion in order', async () => {
  const env = await setup(); const { sessionId } = await env.agent.start({ mode: 'edit' }); await env.agent.send({ sessionId, text: 'Check the timeline' });
  env.inject({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Checking' } } }, { type: 'assistant', message: { content: [{ type: 'text', text: 'Checking' }, { type: 'tool_use', id: 'tool-1', name: 'timeline_get', input: {} }] } }, { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: [{ type: 'text', text: '{"revision":1}' }] }] } }, { type: 'assistant', message: { content: [{ type: 'text', text: 'Done' }] } });
  await new Promise((resolve) => setTimeout(resolve, 0)); expect(env.events.filter((event) => ['text_delta', 'message', 'tool_start', 'tool_end'].includes(event.type)).map((event) => event.type)).toEqual(['message', 'text_delta', 'message', 'tool_start', 'tool_end', 'message']);
  expect(env.events).toContainEqual({ type: 'tool_end', sessionId, toolUseId: 'tool-1', name: 'timeline_get', output: '{"revision":1}', isError: false }); expect(env.events.at(-1)).toMatchObject({ type: 'message', role: 'assistant', text: 'Done' });
});
it('omits write MCP tools in Ask and passes hosted MCP only when explicitly enabled', async () => {
  const ask = await setup(['cutroom', 'elevenlabs-hosted']); await ask.agent.start({ mode: 'ask' }); expect(ask.servers.get('cutroom')!.map((tool) => tool.name)).not.toContain('timeline_apply'); expect(ask.options().mcpServers).not.toHaveProperty('elevenlabs-hosted');
  const edit = await setup(['cutroom', 'elevenlabs-hosted']); await edit.agent.start({ mode: 'edit' }); expect(edit.options().mcpServers).toHaveProperty('elevenlabs-hosted', { type: 'http', url: 'https://api.elevenlabs.io/v1/mcp' });
  const disabled = await setup(['cutroom']); await disabled.agent.start({ mode: 'edit' }); expect(disabled.options().mcpServers).not.toHaveProperty('elevenlabs-hosted');
});
it.each([false, true])('requires user permission before force-overwriting an edited property (allow=%s)', async (allow) => {
  const env = await setup(); await env.timeline.apply([{ type: 'addItem', trackId: 'video', item: { type: 'clip', id: 'clip_abcdefghij', src: 'raw/clip.mp4', start: 0, duration: 3, in: 0, out: 3, speed: 1, volume: 1, muted: false, createdBy: 'user', userEdited: [] } }], { actor: 'system', label: 'Import' });
  await env.timeline.apply([{ type: 'setProps', itemId: 'clip_abcdefghij', patch: { volume: 0.2 } }], { actor: 'user', label: 'My volume' }); const before = env.timeline.state();
  const { sessionId } = await env.agent.start({ mode: 'edit' }); await env.agent.send({ sessionId, text: 'Override my volume' }); const tool = env.servers.get('cutroom')!.find((tool) => tool.name === 'timeline_apply')!;
  const pending = tool.handler({ ops: [{ type: 'setProps', itemId: 'clip_abcdefghij', patch: { volume: 0.8 } }], label: 'Override', baseRevision: before.revision, force: true }); await new Promise((resolve) => setTimeout(resolve, 0));
  const permission = env.events.find((event) => event.type === 'permission_request'); if (permission?.type !== 'permission_request') throw new Error('Missing force permission'); expect(permission.tool).toBe('overwrite_user_edits'); expect(env.timeline.state()).toEqual(before);
  env.agent.respond({ requestId: permission.requestId, allow }); const result = await pending;
  if (allow) { expect(result).not.toHaveProperty('isError', true); expect(env.timeline.state().revision).toBe(before.revision + 1); expect(env.timeline.state().doc.tracks[3]!.items[0]).toMatchObject({ volume: 0.8 }); }
  else { expect(result).toHaveProperty('isError', true); expect(env.timeline.state()).toEqual(before); }
});
it('requires explicit rights permission and denial never starts a URL download', async () => {
  const env = await setup(); const { sessionId } = await env.agent.start({ mode: 'edit' }); await env.agent.send({ sessionId, text: 'Download this video https://example.com/video' }); const tool = env.servers.get('cutroom')!.find((tool) => tool.name === 'url_import_download')!;
  const pending = tool.handler({ url: 'https://example.com/video', formatId: 'best', destination: 'references' }); await new Promise((resolve) => setTimeout(resolve, 0)); const permission = env.events.find((event) => event.type === 'permission_request'); expect(permission?.type).toBe('permission_request'); if (permission?.type !== 'permission_request') throw new Error('Missing permission prompt'); expect(permission.description).toContain('rights'); env.agent.respond({ requestId: permission.requestId, allow: false }); expect(await pending).toHaveProperty('isError', true); expect(env.downloads()).toBe(0);
});

const questionInput = { questions: [{ question: 'Where will this video be published?', header: 'Platform', multiSelect: false, options: [{ label: 'YouTube', description: 'Landscape explainer' }, { label: 'Reels', description: 'Vertical short' }] }] };
const toolOptions = () => ({ signal: new AbortController().signal, toolUseID: 'test-tool', requestId: 'test-request' });
const permissionEvents = (events: AgentEvent[]) => events.filter((event) => event.type === 'permission_request');
it('auto-approves ordinary edits, reads settings each call, and remembers only the selected tool in this session', async () => {
  const env = await setup(); await env.agent.start({ mode: 'edit' }); const use = env.options().canUseTool!;
  await expect(use('mcp__cutroom__timeline_apply', {}, toolOptions())).resolves.toMatchObject({ behavior: 'allow' }); expect(permissionEvents(env.events)).toEqual([]);
  env.settings.agent.approvalMode = 'ask';
  const pending = use('mcp__cutroom__timeline_apply', {}, toolOptions()); await vi.waitFor(() => expect(permissionEvents(env.events)).toHaveLength(1)); const permission = permissionEvents(env.events).at(-1)!; expect(permission.rememberable).toBe(true);
  env.agent.respond({ requestId: permission.requestId, allow: true, scope: 'session' }); await expect(pending).resolves.toMatchObject({ behavior: 'allow' });
  await expect(use('mcp__cutroom__timeline_apply', {}, toolOptions())).resolves.toMatchObject({ behavior: 'allow' }); expect(permissionEvents(env.events)).toHaveLength(1);
  const other = use('mcp__cutroom__compositions_create', {}, toolOptions()); await vi.waitFor(() => expect(permissionEvents(env.events)).toHaveLength(2)); const second = permissionEvents(env.events).at(-1)!; env.agent.respond({ requestId: second.requestId, allow: false }); await expect(other).resolves.toMatchObject({ behavior: 'deny' });
  await env.agent.start({ mode: 'edit' }); const next = env.options().canUseTool!('mcp__cutroom__timeline_apply', {}, toolOptions()); await vi.waitFor(() => expect(permissionEvents(env.events)).toHaveLength(3)); const third = permissionEvents(env.events).at(-1)!; expect(third.requestId).not.toBe(permission.requestId); env.agent.respond({ requestId: third.requestId, allow: false }); await next;
});
it.each(['auto', 'ask'] as const)('rights and skill-save confirmations occur exactly once in %s and cannot be remembered', async (approvalMode) => {
  const env = await setup(); env.settings.agent.approvalMode = approvalMode; const { sessionId } = await env.agent.start({ mode: 'edit' }); await env.agent.send({ sessionId, text: 'Use this source https://example.com/video' });
  const use = env.options().canUseTool!;
  for (const name of ['url_import_download', 'skill_save']) {
    await expect(use(`mcp__cutroom__${name}`, {}, toolOptions())).resolves.toMatchObject({ behavior: 'allow' });
    const tool = env.servers.get('cutroom')!.find((tool) => tool.name === name)!;
    const input = name === 'skill_save' ? { name: 'Reusable video', description: 'A general story format', instructions: 'Use a hook and a closing summary.', compositions: [] } : { url: 'https://example.com/video', formatId: 'best', destination: 'references' };
    for (let attempt = 0; attempt < 2; attempt++) {
      const before = permissionEvents(env.events).length; const pending = tool.handler(input); await vi.waitFor(() => expect(permissionEvents(env.events)).toHaveLength(before + 1));
      const permission = permissionEvents(env.events).at(-1)!; expect(permission.rememberable).toBe(false); env.agent.respond({ requestId: permission.requestId, allow: true, scope: 'session' }); expect(await pending).not.toHaveProperty('isError', true);
    }
  }
  expect(env.downloads()).toBe(2); expect(env.saveSkill).toHaveBeenCalledTimes(2);
});
it.each(['auto', 'ask'] as const)('forced timeline edits skip the outer prompt but always confirm once in %s', async (approvalMode) => {
  const env = await setup(); env.settings.agent.approvalMode = approvalMode; await env.agent.start({ mode: 'edit' }); const input = { ops: [{ type: 'setTrack', trackId: 'video', muted: true }], label: 'Force', force: true };
  await expect(env.options().canUseTool!('mcp__cutroom__timeline_apply', input, toolOptions())).resolves.toMatchObject({ behavior: 'allow' }); expect(permissionEvents(env.events)).toEqual([]);
  const pending = env.servers.get('cutroom')!.find((tool) => tool.name === 'timeline_apply')!.handler(input); await vi.waitFor(() => expect(permissionEvents(env.events)).toHaveLength(1)); const permission = permissionEvents(env.events)[0]!; expect(permission).toMatchObject({ tool: 'overwrite_user_edits', rememberable: false }); env.agent.respond({ requestId: permission.requestId, allow: false }); expect(await pending).toHaveProperty('isError', true);
});
it('blocks thin-brief mutations until an actual question answer, without a generic permission prompt', async () => {
  const env = await setup(); const { sessionId } = await env.agent.start({ mode: 'edit' }); await env.agent.send({ sessionId, text: 'Make a cool video' });
  expect((await env.nextPrompt()).value?.message.content).toContain('Before creating anything');
  const tool = env.servers.get('cutroom')!.find((tool) => tool.name === 'timeline_apply')!; const input = { ops: [{ type: 'setTrack', trackId: 'video', muted: true }], label: 'Mute' }; const before = env.timeline.state();
  expect(await tool.handler(input)).toHaveProperty('isError', true); expect(env.timeline.state()).toEqual(before);
  const file = await env.options().canUseTool!('Write', { file_path: 'work/generated.txt' }, toolOptions()); expect(file?.behavior).toBe('deny');
  let settled = false; const pending = env.options().canUseTool!('AskUserQuestion', questionInput, toolOptions()).then((result) => { settled = true; return result; });
  await Promise.resolve(); expect(settled).toBe(false); expect(permissionEvents(env.events)).toEqual([]);
  const question = env.events.find((event) => event.type === 'question_request'); if (question?.type !== 'question_request') throw new Error('Missing question'); expect(env.events).toContainEqual({ type: 'status', sessionId, status: 'waiting_input' });
  expect(() => env.agent.respondQuestion({ requestId: question.requestId, answers: {} })).toThrow('Answer each'); expect(() => env.agent.respondQuestion({ requestId: question.requestId, answers: { wrong: 'YouTube' } })).toThrow('Answer each');
  const answers = { [questionInput.questions[0]!.question]: 'Reels' }; env.agent.respondQuestion({ requestId: question.requestId, answers }); await expect(pending).resolves.toMatchObject({ behavior: 'allow', updatedInput: { questions: questionInput.questions, answers } });
  expect(await tool.handler(input)).not.toHaveProperty('isError', true); expect(env.timeline.state().revision).toBe(before.revision + 1); expect(() => env.agent.respondQuestion({ requestId: question.requestId, answers })).toThrow('expired');
});
it('interrupt cancels pending questions and a follow-up user message releases the brief gate', async () => {
  const env = await setup(); const { sessionId } = await env.agent.start({ mode: 'edit' }); await env.agent.send({ sessionId, text: 'Make a video' });
  const pending = env.options().canUseTool!('AskUserQuestion', questionInput, toolOptions()); const question = env.events.find((event) => event.type === 'question_request'); if (question?.type !== 'question_request') throw new Error('Missing question');
  await env.agent.interrupt(sessionId); await expect(pending).resolves.toMatchObject({ behavior: 'deny' }); expect(() => env.agent.respondQuestion({ requestId: question.requestId, answers: {}, response: 'A landscape explainer' })).toThrow('expired');
  await env.agent.send({ sessionId, text: 'A short explainer' }); expect(await env.servers.get('cutroom')!.find((tool) => tool.name === 'timeline_apply')!.handler({ ops: [{ type: 'setTrack', trackId: 'video', muted: true }], label: 'Mute' })).not.toHaveProperty('isError', true);
});
it.each(['reference', 'skill'] as const)('a %s bypasses the thin gate and skill instructions are prepended without local SDK settings', async (context) => {
  const env = await setup(); if (context === 'reference') { await mkdir(path.join(env.root, 'references')); await writeFile(path.join(env.root, 'references/brief.txt'), 'Use this reference'); }
  const { sessionId } = await env.agent.start({ mode: 'edit' }); await env.agent.send({ sessionId, text: 'Make a video', ...(context === 'skill' ? { skillId: 'podcast-clip' } : {}) });
  const content = (await env.nextPrompt()).value?.message.content; expect(content).not.toContain('Before creating anything'); if (context === 'skill') expect(content).toContain('Keep the exchange faithful'); expect(env.options().settingSources).toEqual([]);
  expect(await env.servers.get('cutroom')!.find((tool) => tool.name === 'timeline_apply')!.handler({ ops: [{ type: 'setTrack', trackId: 'video', muted: true }], label: 'Mute' })).not.toHaveProperty('isError', true);
});
it('applies every selected skill template and returns names plus reusable instructions', async () => {
  const env = await setup(); env.readSkill.mockResolvedValue({ ...await env.readSkill(), compositions: ['opener', 'closing'] });
  const { sessionId } = await env.agent.start({ mode: 'edit' }); await env.agent.send({ sessionId, text: 'Make this', skillId: 'podcast-clip' });
  const result = await env.servers.get('cutroom')!.find((tool) => tool.name === 'skill_apply')!.handler({ id: 'podcast-clip' });
  expect(env.applySkill.mock.calls).toEqual([['podcast-clip', 'opener', 'opener'], ['podcast-clip', 'closing', 'closing']]);
  expect(result).toMatchObject({ content: [{ type: 'text', text: expect.stringContaining('"names":["opener","closing"]') }] }); expect(result).not.toHaveProperty('isError', true);
});
it('does not time out unanswered questions after ten minutes, but cancels on the tool signal', async () => {
  const env = await setup(); await env.agent.start({ mode: 'edit' }); const controller = new AbortController(); let settled = false;
  vi.useFakeTimers();
  try {
    const pending = env.options().canUseTool!('AskUserQuestion', questionInput, { ...toolOptions(), signal: controller.signal }).then((answer) => { settled = true; return answer; });
    await vi.advanceTimersByTimeAsync(11 * 60 * 1000); expect(settled).toBe(false); controller.abort(); await expect(pending).resolves.toMatchObject({ behavior: 'deny' });
  } finally { vi.useRealTimers(); }
});
it('accepts only one of two concurrent sends while loading first-turn context', async () => {
  const env = await setup(); const { sessionId } = await env.agent.start({ mode: 'edit' });
  const results = await Promise.allSettled([env.agent.send({ sessionId, text: 'Make a video' }), env.agent.send({ sessionId, text: 'Make another video' })]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1); expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: { code: 'conflict' } });
  expect(env.events.filter((event) => event.type === 'message' && event.role === 'user')).toHaveLength(1);
});
