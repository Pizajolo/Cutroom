import { randomUUID } from 'node:crypto';
import { z } from 'zod/v3';
import type { McpServerConfig, Query, SDKUserMessage, Options } from '@anthropic-ai/claude-agent-sdk';
import { contract, IpcFailure, type InvokeReq } from '@shared/ipc/contract';
import { agentSessionSchema, type AgentEvent, type AgentSession } from '@shared/schema/agent';
import { opSchema } from '@shared/timeline/types';
import { audioPlacementSchema } from '@shared/schema/audio';
import { projectPathSchema, secondsSchema } from '@shared/schema/common';
import { atomicJson, isMissing, readManaged } from '../fs/managed';
import { claudeAgentEnv } from '../claude/env';
import { resolveClaudeBinary } from '../claude/binary';
import type { WorkflowRuntime } from '../projects/runtime';
import type { MediaService } from '../media/service';
import type { ExtensionSecretStore } from '../secrets/keychain';
import { agentPolicy, AGENT_MODELS, guardAgentFile } from './policy';
import { ChangeReview } from './review';
import type { TimelineChange } from '../timeline/service';

type Sdk = typeof import('@anthropic-ai/claude-agent-sdk');
class Input implements AsyncIterable<SDKUserMessage> {
  private queue: SDKUserMessage[] = []; private wake?: () => void; private ended = false;
  push(message: SDKUserMessage): void { this.queue.push(message); this.wake?.(); }
  close(): void { this.ended = true; this.wake?.(); }
  async *[Symbol.asyncIterator](): AsyncGenerator<SDKUserMessage> { while (!this.ended) { const message = this.queue.shift(); if (message) yield message; else await new Promise<void>((resolve) => { this.wake = resolve; }); } }
}
interface Session { info: AgentSession; root: string; input: Input; query?: Query; controller: AbortController; turn: AbortController; requestId?: string; context?: InvokeReq<'agent.send'>['context']; snapshot?: Promise<unknown>; task?: Promise<void> }
interface Permission { sessionId: string; resolve: (allowed: boolean) => void }
const jsonResult = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value ?? null) }] });
const toolUseBlock = z.object({ type: z.literal('tool_use'), id: z.string().min(1), name: z.string(), input: z.record(z.unknown()) });
const toolResultBlock = z.object({ type: z.literal('tool_result'), tool_use_id: z.string().min(1), content: z.unknown().optional(), is_error: z.boolean().optional() });
const messageText = (content: unknown): string => typeof content === 'string' ? content : Array.isArray(content) ? content.flatMap((part: unknown) => { const text = z.object({ type: z.literal('text'), text: z.string() }).safeParse(part); return text.success ? [text.data.text] : []; }).join('\n') : '';
export class AgentService {
  readonly review = new ChangeReview();
  private readonly sessions = new Map<string, Session>(); private readonly permissions = new Map<string, Permission>(); private readonly serverStates = new Map<string, { status: 'ready' | 'unavailable'; detail: string | null }>();
  constructor(private readonly options: { runtime: WorkflowRuntime; media: MediaService; secrets: ExtensionSecretStore; emit: (event: AgentEvent) => void; sdk?: () => Promise<Sdk>; env?: () => Promise<Record<string, string>>; binary?: () => Promise<{ path: string } | null> }) {}
  private emit(_session: Session, event: AgentEvent): void { this.options.emit(event); }
  private status(session: Session, status: AgentSession['status']): void { session.info.status = status; this.emit(session, { type: 'status', sessionId: session.info.id, status }); }
  private require(id: string): Session { const session = this.sessions.get(id); if (!session || session.info.projectId !== this.options.runtime.projects.current()?.project.id) throw new IpcFailure({ code: 'not_found', message: 'Start an assistant session in the current project.' }); return session; }
  async list(): Promise<AgentSession[]> {
    const project = this.options.runtime.projects.require();
    try { const saved = z.array(agentSessionSchema).parse(JSON.parse(await readManaged(project.rootPath, '.cutroom/agent-sessions.json'))); return saved.map((info) => this.sessions.get(info.id)?.info ?? { ...info, status: 'idle' as const }); }
    catch (error) { if (isMissing(error)) return []; throw error; }
  }
  private async persist(session: Session): Promise<void> {
    const saved = await this.list(); const next = [...saved.filter((info) => info.id !== session.info.id), session.info].slice(-100); await atomicJson(session.root, '.cutroom/agent-sessions.json', next);
  }
  start(request: InvokeReq<'agent.start'>): Promise<{ sessionId: string }> { return this.startSession(request); }
  private async startSession(request: InvokeReq<'agent.start'>, saved?: AgentSession): Promise<{ sessionId: string }> {
    const project = this.options.runtime.projects.require(); const model = request.model ?? AGENT_MODELS[0];
    if (!(AGENT_MODELS as readonly string[]).includes(model)) throw new IpcFailure({ code: 'invalid_request', message: 'Choose a supported Claude model.' });
    const [sdk, env, binary] = await Promise.all([(this.options.sdk ?? (() => import('@anthropic-ai/claude-agent-sdk')))(), (this.options.env ?? claudeAgentEnv)(), (this.options.binary ?? resolveClaudeBinary)()]);
    if (!binary) throw new IpcFailure({ code: 'unavailable', message: 'Install Claude Code and sign in in Settings → Accounts.' });
    if (this.options.runtime.projects.current()?.project.id !== project.project.id) throw new IpcFailure({ code: 'conflict', message: 'The project changed. Retry starting the assistant.' });
    const id = saved?.id ?? randomUUID(); const session: Session = { info: { id, projectId: project.project.id, mode: request.mode, model, status: 'starting', createdAt: new Date().toISOString() }, root: project.rootPath, input: new Input(), controller: new AbortController(), turn: new AbortController() };
    this.sessions.set(id, session);
    try {
      const servers = await this.servers(sdk, session);
      const options: Options = { ...agentPolicy(project.rootPath, request.mode, this.options.runtime.settings.get()), cwd: project.rootPath, env, pathToClaudeCodeExecutable: binary.path, model, ...(saved ? { resume: id } : { sessionId: id }), abortController: session.controller, includePartialMessages: true,
        systemPrompt: { type: 'preset', preset: 'claude_code', append: 'You are the Cutroom editing assistant. Times are seconds, timeline positions are output-frame quantized. Use cutroom MCP tools for timeline changes, never write timeline.json or .cutroom/. raw/, references/, assets/ and existing root media are read-only originals. Write authored compositions only under compositions/ and scratch files under work/. Edits are live and reviewable. Never delete source media. Ask mode is read-only. Never download video without explicit rights permission. Codex is a read-only delegated helper, not a Claude model endpoint.' },
        mcpServers: servers, canUseTool: async (name, input, extra) => {
          if (['Read', 'Glob', 'Grep'].includes(name)) { try { await guardAgentFile(session.root, name, input, session.info.mode); return { behavior: 'allow', updatedInput: input }; } catch { return { behavior: 'deny', message: 'This path is outside the project.' }; } }
          const allow = await this.permission(session, name, input, extra.signal); return allow ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'The user denied this operation.' };
        }, hooks: { PreToolUse: [{ hooks: [async (input) => {
          if (input.hook_event_name !== 'PreToolUse') return {};
          const data = z.record(z.unknown()).safeParse(input.tool_input); if (!data.success) return { decision: 'block', reason: 'Invalid tool input.' };
          try { await guardAgentFile(session.root, input.tool_name, data.data, session.info.mode); if (input.tool_name === 'Write' || input.tool_name === 'Edit') await this.beforeEdit(session); }
          catch { return { decision: 'block', reason: 'File access is outside the permitted project folders.' }; }
          return {};
        }] }] } };
      session.query = sdk.query({ prompt: session.input, options }); await this.persist(session); session.task = this.consume(session); this.status(session, 'idle'); return { sessionId: id };
    } catch (error) { session.controller.abort(); session.input.close(); session.query?.close(); this.sessions.delete(id); if (error instanceof IpcFailure) throw error; throw new IpcFailure({ code: 'unavailable', message: 'The Claude assistant could not start. Check your Claude Code installation and connection.' }); }
  }
  async send(request: InvokeReq<'agent.send'>): Promise<{ ok: true }> {
    let session = this.sessions.get(request.sessionId);
    if (!session) {
      const saved = (await this.list()).find((entry) => entry.id === request.sessionId); if (!saved) throw new IpcFailure({ code: 'not_found', message: 'Assistant session not found.' });
      // A saved conversation is resumed by the SDK, never by reading its credential files.
      const started = await this.startSession({ mode: saved.mode, model: saved.model }, saved); session = this.require(started.sessionId);
    }
    session = this.require(session.info.id);
    if (!['idle', 'finished', 'interrupted'].includes(session.info.status)) throw new IpcFailure({ code: 'conflict', message: 'Wait for this assistant turn to finish or interrupt it.' });
    session.requestId = randomUUID(); session.context = request.context; session.snapshot = undefined; session.turn = new AbortController();
    this.status(session, 'thinking'); this.emit(session, { type: 'message', sessionId: session.info.id, role: 'user', text: request.text });
    session.input.push({ type: 'user', message: { role: 'user', content: `${request.text}${request.context ? `\n\nEditor context: ${JSON.stringify(request.context)}` : ''}` }, parent_tool_use_id: null, session_id: session.info.id }); return { ok: true };
  }
  private async consume(session: Session): Promise<void> {
    const tools = new Map<string, string>();
    try { for await (const message of session.query!) {
      if (message.type === 'stream_event' && message.event.type === 'content_block_delta' && message.event.delta.type === 'text_delta') this.emit(session, { type: 'text_delta', sessionId: session.info.id, text: message.event.delta.text });
      if (message.type === 'assistant') {
        const text = messageText(message.message.content);
        if (text) this.emit(session, { type: 'message', sessionId: session.info.id, role: 'assistant', text });
        for (const raw of z.array(z.unknown()).parse(message.message.content)) { const block = toolUseBlock.safeParse(raw); if (!block.success) continue; tools.set(block.data.id, block.data.name); this.status(session, 'running'); this.emit(session, { type: 'tool_start', sessionId: session.info.id, toolUseId: block.data.id, name: block.data.name, input: block.data.input }); }
      }
      if (message.type === 'user' && Array.isArray(message.message.content)) for (const raw of z.array(z.unknown()).parse(message.message.content)) {
        const block = toolResultBlock.safeParse(raw); if (!block.success) continue;
        const name = tools.get(block.data.tool_use_id); if (!name) continue; tools.delete(block.data.tool_use_id);
        this.emit(session, { type: 'tool_end', sessionId: session.info.id, toolUseId: block.data.tool_use_id, name, output: messageText(block.data.content).slice(0, 16_384), isError: block.data.is_error === true });
      }
      if (message.type === 'result') {
        tools.clear(); this.status(session, 'finished'); this.emit(session, { type: 'result', sessionId: session.info.id, costUsd: message.total_cost_usd, inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens }); await this.persist(session);
        if (message.is_error) this.emit(session, { type: 'error', sessionId: session.info.id, code: 'unavailable', message: 'Claude could not complete this turn. Check the connection and account permissions.' });
        void session.query!.mcpServerStatus().then((statuses) => { for (const status of statuses) this.serverStates.set(status.name, { status: status.status === 'connected' ? 'ready' : 'unavailable', detail: status.status === 'connected' ? null : 'MCP server is not connected. Check the extension and its authorization.' }); }).catch(() => undefined);
      }
    } } catch { if (!session.controller.signal.aborted) this.emit(session, { type: 'error', sessionId: session.info.id, code: 'unavailable', message: 'The Claude session ended unexpectedly. Start a new session or reconnect in Settings → Accounts.' }); }
    finally { session.input.close(); session.turn.abort(); this.status(session, 'interrupted'); if (this.sessions.get(session.info.id) === session) this.sessions.delete(session.info.id); }
  }
  private async permission(session: Session, tool: string, input: Record<string, unknown>, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted || session.controller.signal.aborted) return false;
    const requestId = randomUUID(); this.status(session, 'waiting_permission');
    return new Promise<boolean>((resolve) => {
      const combined = AbortSignal.any([signal, session.turn.signal, session.controller.signal, AbortSignal.timeout(10 * 60_000)]);
      let settled = false;
      const finish = (allow: boolean): void => { if (settled) return; settled = true; this.permissions.delete(requestId); combined.removeEventListener('abort', abort); if (!combined.aborted) this.status(session, 'running'); resolve(allow); };
      const abort = (): void => finish(false); this.permissions.set(requestId, { sessionId: session.info.id, resolve: finish }); combined.addEventListener('abort', abort, { once: true }); if (combined.aborted) { abort(); return; }
      this.emit(session, { type: 'permission_request', sessionId: session.info.id, requestId, tool, input, rememberable: false, description: tool === 'url_import_download' ? 'Confirm you have the rights to download this video.' : `Allow ${tool} for this request?` });
    });
  }
  respond(request: InvokeReq<'agent.respondPermission'>): { ok: true } { const permission = this.permissions.get(request.requestId); if (!permission) throw new IpcFailure({ code: 'not_found', message: 'This permission request expired.' }); this.require(permission.sessionId); permission.resolve(request.allow); return { ok: true }; }
  async interrupt(id: string): Promise<{ ok: true }> { const session = this.require(id); session.turn.abort(); await session.query?.interrupt(); this.status(session, 'interrupted'); return { ok: true }; }
  async beforeEdit(session: Session): Promise<void> { if (session.info.mode === 'ask') throw new IpcFailure({ code: 'forbidden', message: 'Ask mode is read-only.' }); if (this.options.runtime.settings.get().snapshots.autoBeforeAgent) { session.snapshot ??= this.options.runtime.timeline().createSnapshot('Before assistant edit'); await session.snapshot; } }
  record(change: TimelineChange): void { const session = [...this.sessions.values()].find((entry) => entry.requestId === change.requestId); if (!session) return; for (const entry of this.review.record(change)) this.emit(session, { type: 'change', sessionId: session.info.id, requestId: change.requestId!, ...entry }); }
  extensionStatus(id: string) { return this.serverStates.get(id); }
  async close(): Promise<void> { for (const session of this.sessions.values()) { session.turn.abort(); session.controller.abort(); session.input.close(); session.query?.close(); } await Promise.allSettled([...this.sessions.values()].map((session) => session.task)); this.sessions.clear(); this.permissions.clear(); this.review.clear(); this.serverStates.clear(); }
  private async servers(sdk: Sdk, session: Session): Promise<Record<string, McpServerConfig>> {
    const runtime = this.options.runtime; const servers: Record<string, McpServerConfig> = {};
    const waitForJob = async (jobId: string, signal: AbortSignal): Promise<unknown> => {
      const abort = (): void => { void runtime.jobs.cancel(jobId).catch(() => undefined); };
      signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
      try { const done = await runtime.jobs.wait(jobId); if (done.status !== 'done' || signal.aborted) throw new IpcFailure({ code: 'unavailable', message: 'The assistant job failed or was cancelled.' }); return done.result; }
      finally { signal.removeEventListener('abort', abort); }
    };
    const tools: NonNullable<Parameters<Sdk['createSdkMcpServer']>[0]['tools']> = [];
    const add = <S extends z.ZodRawShape>(name: string, description: string, shape: S, action: (input: z.infer<z.ZodObject<S>>) => Promise<unknown> | unknown, write = false): void => {
      if (write && session.info.mode === 'ask') return;
      tools.push(sdk.tool(name, description, shape, async (raw) => {
        try { this.require(session.info.id); session.turn.signal.throwIfAborted(); if (write) await this.beforeEdit(session); const input = z.object(shape).strict().parse(raw); return jsonResult(await action(input)); }
        catch (error) { return { ...jsonResult({ error: error instanceof IpcFailure ? error.message : 'The editor tool could not complete this request.' }), isError: true }; }
      }));
    };
    add('project_info', 'Read the current project.', {}, () => runtime.projects.require());
    add('media_list', 'List project media.', {}, () => this.options.media.list());
    add('media_probe', 'Probe media duration and streams.', { rel: projectPathSchema }, ({ rel }) => this.options.media.probeFile(rel));
    add('timeline_get', 'Read timeline and revision.', {}, () => runtime.timeline().state());
    add('timeline_apply', 'Apply public timeline operations live. Force requires explicit user approval to replace user-edited fields.', { ops: z.array(opSchema).min(1).max(1000), label: z.string().min(1), baseRevision: z.number().int().optional(), force: z.boolean().optional() }, async ({ ops, label, baseRevision, force }) => { if (force && !await this.permission(session, 'overwrite_user_edits', { ops, label }, session.turn.signal)) throw new IpcFailure({ code: 'forbidden', message: 'Replacing user-edited properties was not approved.' }); return runtime.timeline().apply(ops, { actor: `agent:${session.info.id}`, requestId: session.requestId, label, baseRevision, force: force === true }); }, true);
    add('playhead_get', 'Read the playhead supplied with this user message.', {}, () => ({ time: session.context?.time ?? 0 }));
    add('selection_get', 'Read the selection supplied with this user message.', {}, () => ({ itemIds: session.context?.itemIds ?? [] }));
    add('playhead_seek', 'Seek the editor playhead to a timeline time in seconds.', { time: secondsSchema }, ({ time }) => { session.context = { ...session.context, itemIds: session.context?.itemIds ?? [], time }; this.emit(session, { type: 'playhead_seek', sessionId: session.info.id, time }); return { time }; });
    add('transcript_get', 'Read a cached transcript.', { rel: projectPathSchema }, ({ rel }) => runtime.transcripts.get(rel));
    add('transcribe_start', 'Start an explicitly selected transcription engine.', contract.invoke['transcripts.start'].req.shape, (input) => runtime.transcripts.start(input), true);
    add('captions_generate', 'Generate trimmed, speed-mapped captions.', contract.invoke['captions.generate'].req.shape, ({ clipItemId }) => runtime.transcripts.captions(clipItemId, `agent:${session.info.id}`, session.requestId), true);
    add('compositions_list', 'List editable compositions.', {}, () => runtime.compositions.list());
    add('compositions_create', 'Copy a built-in composition template.', contract.invoke['compositions.create'].req.shape, ({ template, name }) => runtime.compositions.create(template, name), true);
    add('compositions_check', 'Check composition markup and props.', contract.invoke['compositions.check'].req.shape, ({ name }) => runtime.compositions.check(name));
    add('export_preflight', 'Check export support and tool availability.', contract.invoke['export.preflight'].req.shape, (input) => runtime.exports.preflight(input));
    add('export_start', 'Start an export job.', contract.invoke['export.start'].req.shape, (input) => runtime.exports.start(input), true);
    add('job_status', 'Read a job status.', { id: z.string() }, ({ id }) => runtime.jobs.list(session.info.projectId).find((job) => job.id === id) ?? null);
    add('snapshot_create', 'Save a project snapshot.', { label: z.string().min(1) }, ({ label }) => runtime.timeline().createSnapshot(label), true);
    add('url_import_fetch', 'Fetch public URL formats without downloading media.', contract.invoke['urlImport.fetch'].req.shape, ({ url }) => runtime.urls.fetch(url));
    add('url_import_download', 'Download only after the user confirms their rights.', contract.invoke['urlImport.download'].req.omit({ rightsConfirmed: true }).shape, async (input) => { if (!await this.permission(session, 'url_import_download', input, session.turn.signal)) throw new IpcFailure({ code: 'forbidden', message: 'Download was not approved.' }); return runtime.urls.download({ ...input, rightsConfirmed: true }); }, true);
    if (runtime.extensions.enabled('cutroom')) servers.cutroom = sdk.createSdkMcpServer({ name: 'cutroom', tools });
    if (session.info.mode === 'edit' && runtime.extensions.enabled('codex')) {
      const status = await runtime.codex.status(); if (status.available && status.loggedIn) servers.codex = sdk.createSdkMcpServer({ name: 'codex', tools: [sdk.tool('codex_task', 'Delegate a read-only ephemeral research task to the official Codex CLI.', { prompt: z.string().min(1).max(100_000), model: z.string().min(1).optional() }, async (input) => { try { return jsonResult(await runtime.codex.task(session.root, input, session.turn.signal)); } catch { return { ...jsonResult({ error: 'Codex task could not complete. Check its CLI sign-in.' }), isError: true }; } })] });
    }
    if (session.info.mode === 'edit' && runtime.extensions.enabled('elevenlabs') && runtime.settings.get().accounts.elevenlabs.status === 'connected') {
      const audioTools: NonNullable<Parameters<Sdk['createSdkMcpServer']>[0]['tools']> = [sdk.tool('list_voices', 'List available ElevenLabs voices.', {}, async () => { try { return jsonResult(await runtime.audio.voices()); } catch { return { ...jsonResult({ error: 'Could not list voices. Check ElevenLabs in Accounts.' }), isError: true }; } })];
      const audio = <S extends z.ZodRawShape>(name: string, shape: S, make: (input: z.infer<z.ZodObject<S>>) => InvokeReq<'audio.generate'>): void => { audioTools.push(sdk.tool(name, 'Generate audio with ElevenLabs; returns its project-relative path.', shape, async (input) => { try { this.require(session.info.id); const signal = session.turn.signal; const requestId = session.requestId; signal.throwIfAborted(); await this.beforeEdit(session); signal.throwIfAborted(); const job = await runtime.audio.generate(make(z.object(shape).strict().parse(input)), { actor: `agent:${session.info.id}`, requestId }); return jsonResult(await waitForJob(job.jobId, signal)); } catch { return { ...jsonResult({ error: 'Audio generation failed or was cancelled. Check ElevenLabs and the job status.' }), isError: true }; } })); };
      audio('text_to_speech', { text: z.string().min(1), voiceId: z.string().min(1), model: z.string().optional(), placement: audioPlacementSchema.optional() }, (input) => ({ kind: 'tts', ...input }));
      audio('sound_effect', { text: z.string().min(1), durationSec: z.number().min(0.5).max(30).optional(), placement: audioPlacementSchema.optional() }, (input) => ({ kind: 'sfx', ...input }));
      audio('music', { text: z.string().min(1), durationSec: z.number().min(3).max(600), placement: audioPlacementSchema.optional() }, (input) => ({ kind: 'music', ...input }));
      audio('isolate_audio', { rel: projectPathSchema, placement: audioPlacementSchema.optional() }, (input) => ({ kind: 'isolate', ...input }));
      audioTools.push(sdk.tool('speech_to_text', 'Transcribe project media explicitly with Scribe and return the transcript.', { rel: projectPathSchema }, async (input) => { try { this.require(session.info.id); const signal = session.turn.signal; signal.throwIfAborted(); await this.beforeEdit(session); signal.throwIfAborted(); const { rel } = z.object({ rel: projectPathSchema }).strict().parse(input); const job = await runtime.transcripts.start({ rel, engine: 'scribe' }); return jsonResult(await waitForJob(job.jobId, signal)); } catch { return { ...jsonResult({ error: 'Scribe transcription failed or was cancelled.' }), isError: true }; } }));
      servers.elevenlabs = sdk.createSdkMcpServer({ name: 'elevenlabs', tools: audioTools });
    }
    if (session.info.mode === 'edit' && runtime.extensions.enabled('elevenlabs-hosted')) servers['elevenlabs-hosted'] = { type: 'http', url: 'https://api.elevenlabs.io/v1/mcp' };
    if (session.info.mode === 'edit') for (const entry of runtime.settings.get().extensions) {
      const config = entry.config; if (!config.enabled || ['cutroom', 'codex', 'elevenlabs', 'elevenlabs-hosted'].includes(config.id)) continue;
      runtime.extensions.validate(config);
      if (config.transport === 'http') servers[config.id] = { type: 'http', url: config.url };
      else {
        const env: Record<string, string> = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', ELECTRON_RUN_AS_NODE: '1' };
        for (const name of Object.keys(entry.secretEnvRefs)) { const secret = await this.options.secrets.getExtension(config.id, name); if (secret) env[name] = secret; }
        servers[config.id] = { command: config.command, args: config.args, env };
      }
    }
    return servers;
  }
}
