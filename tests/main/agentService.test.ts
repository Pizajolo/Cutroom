import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
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
  const timeline = await TimelineService.load(root, { onChanged: (change) => agent.record(change) }); const events: AgentEvent[] = []; const servers = new Map<string, Tool[]>(); const inbox: SDKMessage[] = []; let options!: Options; let stop: (() => void) | undefined; let closed = false; let downloads = 0;
  const sdk = { tool: (name: string, _description: string, _shape: unknown, handler: Tool['handler']) => ({ name, handler }), createSdkMcpServer: (input: { name: string; tools: Tool[] }) => { servers.set(input.name, input.tools); return { type: 'sdk', name: input.name, instance: {} }; }, query: (input: { options: Options }) => {
    options = input.options; return { async *[Symbol.asyncIterator]() { while (!closed) { const message = inbox.shift(); if (message) yield message; else await new Promise<void>((resolve) => { stop = resolve; }); } }, close: () => { closed = true; stop?.(); }, interrupt: async () => {}, mcpServerStatus: async () => [] };
  } } as unknown as Sdk;
  const project = { rootPath: root, project: { id: 'project' } };
  const runtime = { projects: { require: () => project, current: () => project }, timeline: () => timeline, settings: { get: () => settings }, extensions: { enabled: (id: string) => enabled.includes(id), validate: () => ({}) }, codex: { status: async () => ({ available: false, loggedIn: false, mode: null }) }, urls: { download: async () => { downloads++; return { jobId: 'download' }; } } } as unknown as WorkflowRuntime;
  const agent = new AgentService({ runtime, media: {} as MediaService, secrets: { getExtension: async () => null } as unknown as ExtensionSecretStore, sdk: async () => sdk, env: async () => ({ PATH: '/fixed' }), binary: async () => ({ path: '/fixed/claude' }), emit: (event) => events.push(event) }); agents.push(agent);
  return { root, settings, agent, timeline, events, servers, options: () => options, downloads: () => downloads, inject: (...messages: unknown[]) => { inbox.push(...messages as SDKMessage[]); stop?.(); } };
}
it('builds scoped SDK options and attributes MCP edits to the active request with live review', async () => {
  const env = await setup(['cutroom', 'codex', 'elevenlabs']); const started = await env.agent.start({ mode: 'edit' }); await env.agent.send({ sessionId: started.sessionId, text: 'Add a clip' });
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
  const env = await setup(); const { sessionId } = await env.agent.start({ mode: 'edit' }); await env.agent.send({ sessionId, text: 'Download this video' }); const tool = env.servers.get('cutroom')!.find((tool) => tool.name === 'url_import_download')!;
  const pending = tool.handler({ url: 'https://example.com/video', formatId: 'best', destination: 'references' }); await new Promise((resolve) => setTimeout(resolve, 0)); const permission = env.events.find((event) => event.type === 'permission_request'); expect(permission?.type).toBe('permission_request'); if (permission?.type !== 'permission_request') throw new Error('Missing permission prompt'); expect(permission.description).toContain('rights'); env.agent.respond({ requestId: permission.requestId, allow: false }); expect(await pending).toHaveProperty('isError', true); expect(env.downloads()).toBe(0);
});
