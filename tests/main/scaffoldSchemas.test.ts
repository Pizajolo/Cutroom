import { describe, expect, it, vi } from 'vitest';
import Ajv from 'ajv';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { contract } from '@shared/ipc/contract';
import { validatedEmit, createRequestHandler, reply } from '@main/ipc/validation';
import { notImplemented } from '@main/ipc/stubs';
import { schemaCatalog } from '@shared/schema/catalog';
import { type AgentEvent, audioGenerateRequestSchema, defaultGlobalSettings, exportPresetSchema, globalSettingsSchema, MAX_VOICE_AUDIO_BYTES, projectNameSchema, settingsPatchSchema, timelineDocSchema, voiceTranscribeRequestSchema } from '@shared/schema';
import { applyOp, applyOps, historyOpSchema, opSchema } from '@shared/timeline/ops';
import timelineFixture from '../../src/shared/schema/__fixtures__/timeline.sample.json';
import { scaffoldRequests } from './scaffoldRequests';

const document = timelineDocSchema.parse(timelineFixture);
const item = document.tracks.flatMap((track) => track.items)[0];
if (!item) throw new Error('Expected a fixture item');
const agentEvents = [
  { type: 'status', sessionId: 'session', status: 'thinking' },
  { type: 'text_delta', sessionId: 'session', text: 'Working…' },
  { type: 'message', sessionId: 'session', role: 'assistant', text: 'Done.' },
  { type: 'tool_start', sessionId: 'session', toolUseId: 'tool', name: 'timeline.get', input: {} },
  { type: 'tool_end', sessionId: 'session', toolUseId: 'tool', name: 'timeline.get', output: { revision: 1 }, isError: false },
  { type: 'permission_request', sessionId: 'session', requestId: 'permission', tool: 'export.start', description: 'Export video?', input: { presetId: 'draft' } },
  { type: 'change', sessionId: 'session', requestId: 'review', itemId: item.id, paths: ['start'], before: item, after: { ...item, start: 2 } },
  { type: 'result', sessionId: 'session', costUsd: 0.01, inputTokens: 100, outputTokens: 20 },
  { type: 'error', sessionId: 'session', code: 'unavailable', message: 'Not configured.' },
] satisfies AgentEvent[];
const sender = { frameUrl: 'app://cutroom/', isMainFrame: true, destroyed: false };
const preset = {
  id: 'custom', name: 'Custom H.264', builtin: false, container: 'mp4', vcodec: 'h264', crf: 20,
  size: 'project', fit: 'fit', fps: 'project', audio: { codec: 'aac', loudnessLufs: -14, truePeakDb: -1 },
} as const;

describe('scaffold schema artifacts (in-memory generator)', () => {
  it('runs the actual generator into an isolated temporary directory', async () => {
    const output = await mkdtemp(path.join(tmpdir(), 'cutroom-schema-artifacts-test-'));
    try {
      await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../../scripts/schemas.mjs', import.meta.url))], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', CUTROOM_SCHEMA_OUTPUT: output }, timeout: 30_000,
      });
      expect((await readdir(output)).sort()).toEqual(Object.keys(schemaCatalog).map((name) => `${name}.schema.json`).sort());
      for (const [name, schema] of Object.entries(schemaCatalog)) {
        const generated: unknown = JSON.parse(await readFile(path.join(output, `${name}.schema.json`), 'utf8'));
        expect(generated).toEqual(zodToJsonSchema(schema, { name, target: 'jsonSchema7', $refStrategy: 'none' }));
      }
    } finally { await rm(output, { recursive: true }); }
  }, 40_000);
  it('includes every required new public type in the generator catalog', () => {
    expect(Object.keys(schemaCatalog)).toEqual(expect.arrayContaining([
      'projectSession', 'historyEntry', 'exportPreset', 'settings', 'extensionConfig', 'audioGenerate', 'agentEvent',
    ]));
  });
  it.each(Object.entries(schemaCatalog))('%s produces valid draft-07 JSON Schema', (name, schema) => {
    const generated = zodToJsonSchema(schema, { name, target: 'jsonSchema7', $refStrategy: 'none' });
    expect(new Ajv({ strict: false }).validateSchema(generated)).toBe(true);
    expect(generated.definitions?.[name]).toBeDefined();
  });
});

describe('agent event IPC', () => {
  it('has a test fixture for every discriminated variant', () => {
    expect(agentEvents.map((event) => event.type).sort()).toEqual(contract.events['agent.event'].options.map((option) => option.shape.type.value).sort());
  });
  it.each(agentEvents)('$type round-trips through validatedEmit', (event) => {
    const send = vi.fn();
    expect(validatedEmit(contract.events['agent.event'], JSON.parse(JSON.stringify(event)), send)).toBe(true);
    expect(send).toHaveBeenCalledExactlyOnceWith(event);
    expect(validatedEmit(contract.events['agent.event'], { ...event, sessionId: 123 }, send)).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('history-only full timeline restore', () => {
  it('is rejected by public ops and timeline.apply, accepted only in history', async () => {
    const operation = { type: 'restoreTimeline', doc: document } as const;
    expect(historyOpSchema.parse(operation)).toEqual(operation);
    expect(opSchema.safeParse(operation).success).toBe(false);
    const run = createRequestHandler(contract.invoke['timeline.apply'], notImplemented, { validateResponse: true });
    await expect(reply(() => run(sender, { ops: [operation], label: 'Restore' }))).resolves.toMatchObject({ ok: false, error: { code: 'invalid_request' } });
  });
  it('restores an exact document immutably and provides an inverse', () => {
    const original = structuredClone(document);
    const restored = applyOp(original, { type: 'restoreTimeline', doc: { ...document, markers: [{ id: 'mark', time: 0.042, label: 'Exact', kind: 'marker' }] } });
    expect(restored.doc.markers[0]?.time).toBe(0.042);
    expect(original).toEqual(document);
    expect(applyOps(restored.doc, restored.inverse).doc).toEqual(original);
    restored.doc.tracks[0]?.items.pop();
    expect(original).toEqual(document);
  });
});

describe('new request validation boundaries', () => {
  // Probe (2026-11-02, zod/v3 4.6.7): .url().refine(v => new URL(v)) still
  // executes the refinement on a malformed string and throws TypeError.
  it.each(['not a url', 'file:///private', 'https://user:password@example.com/mcp'])('rejects invalid or credential-bearing URLs as invalid_request: %s', async (url) => {
    const runImport = createRequestHandler(contract.invoke['urlImport.fetch'], notImplemented, { validateResponse: true });
    await expect(reply(() => runImport(sender, { url }))).resolves.toMatchObject({ ok: false, error: { code: 'invalid_request' } });
    const config = { id: 'example', name: 'Example', enabled: false, transport: 'http', url };
    const runExtension = createRequestHandler(contract.invoke['extensions.validate'], notImplemented, { validateResponse: true });
    await expect(reply(() => runExtension(sender, { config }))).resolves.toMatchObject({ ok: false, error: { code: 'invalid_request' } });
  });
  it('rejects unconfirmed URL-download rights before calling the implementation', async () => {
    const impl = vi.fn(notImplemented);
    const run = createRequestHandler(contract.invoke['urlImport.download'], impl, { validateResponse: true });
    await expect(reply(() => run(sender, { ...scaffoldRequests['urlImport.download'], rightsConfirmed: false }))).resolves.toMatchObject({ ok: false, error: { code: 'invalid_request' } });
    expect(impl).not.toHaveBeenCalled();
  });
  it('accepts exactly 10 MB of voice audio and rejects oversized or non-binary data before dispatch', async () => {
    const request = scaffoldRequests['voice.transcribe'];
    expect(voiceTranscribeRequestSchema.safeParse({ ...request, audio: new Uint8Array(MAX_VOICE_AUDIO_BYTES) }).success).toBe(true);
    const impl = vi.fn(notImplemented);
    const run = createRequestHandler(contract.invoke['voice.transcribe'], impl, { validateResponse: true });
    for (const audio of [new Uint8Array(MAX_VOICE_AUDIO_BYTES + 1), new Uint8Array(), [1, 2], new ArrayBuffer(2)]) {
      await expect(reply(() => run(sender, { ...request, audio }))).resolves.toMatchObject({ ok: false, error: { code: 'invalid_request' } });
    }
    expect(impl).not.toHaveBeenCalled();
  });
  it.each(['final/movie.mp4', 'audio/voice.wav'])('allows opening %s', (rel) => {
    expect(contract.invoke['shell.openInProject'].req.safeParse({ rel }).success).toBe(true);
  });
  it.each(['raw/movie.mp4', 'final-backup/movie.mp4', 'audio-other/x.wav', 'final/../raw/movie.mp4', 'final', '/final/movie.mp4'])('refuses opening %s', (rel) => {
    expect(contract.invoke['shell.openInProject'].req.safeParse({ rel }).success).toBe(false);
  });
  it.each(['../project', '/project', 'a/b', 'a\\b', '.', '..', '\u0000project'])('rejects project path disguised as name %j', (name) => {
    expect(projectNameSchema.safeParse(name).success).toBe(false);
  });
  it('rejects secret and credential mutation through settings.update', () => {
    for (const patch of [{ apiKey: 'secret' }, { claude: { credentialRef: 'secret' } }, { accounts: {} }, { extensions: [] }]) {
      expect(settingsPatchSchema.safeParse(patch).success).toBe(false);
    }
    expect(settingsPatchSchema.safeParse({ sandbox: { allowShell: true } }).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ sandbox: { allowWeb: true } }).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ sandbox: { networkByDefault: true } }).success).toBe(false);
  });
  it('stores extension secret references, not secret environment values', () => {
    const config = scaffoldRequests['extensions.add'].config;
    const base = defaultGlobalSettings();
    const saved = { config, secretEnvRefs: { ELEVENLABS_API_KEY: 'keychain:extension:example:ELEVENLABS_API_KEY' } };
    expect(globalSettingsSchema.safeParse({ ...base, extensions: [saved] }).success).toBe(true);
    expect(globalSettingsSchema.safeParse({ ...base, extensions: [{ ...saved, secretEnv: { ELEVENLABS_API_KEY: 'secret' } }] }).success).toBe(false);
    expect(globalSettingsSchema.safeParse({ ...base, extensions: [{ config, apiKey: 'secret' }] }).success).toBe(false);
  });
  it('requires exactly one export quality selector and fixed audio targets', () => {
    expect(exportPresetSchema.parse(preset)).toEqual(preset);
    expect(exportPresetSchema.safeParse({ ...preset, bitrateKbps: 8000 }).success).toBe(false);
    expect(exportPresetSchema.safeParse({ ...preset, crf: undefined }).success).toBe(false);
    expect(exportPresetSchema.safeParse({ ...preset, audio: { ...preset.audio, loudnessLufs: -18 } }).success).toBe(false);
  });
  it.each([
    { kind: 'tts', text: 'Hello', voiceId: 'voice' }, { kind: 'sfx', text: 'Footsteps' },
    { kind: 'music', text: 'Piano', durationSec: 30 }, { kind: 'isolate', rel: 'audio/voice.wav' },
  ])('accepts the strict $kind audio request', (request) => {
    expect(audioGenerateRequestSchema.parse(request)).toEqual(request);
    expect(audioGenerateRequestSchema.safeParse({ ...request, apiKey: 'secret' }).success).toBe(false);
  });
});
