import { describe, expect, it, vi, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { parseWhisper, whisperArgs } from '@main/transcripts/whisper';
import { captionsForClip } from '@shared/captions/generate';
import { allowAudioPermission } from '@main/permissions';
import { ElevenLabsClient } from '@main/elevenlabs/client';
import { AudioService } from '@main/elevenlabs/audio';
import { WorkflowRuntime } from '@main/projects/runtime';
import { SettingsStore } from '@main/settings/store';
import { MediaService } from '@main/media/service';
import { TranscriptsService } from '@main/transcripts/service';
import type { RunCommand } from '@main/process/run';

const roots: string[] = []; const runtimes: WorkflowRuntime[] = []; const mediaServices: MediaService[] = [];
afterEach(async () => { await Promise.all(runtimes.splice(0).map((runtime) => runtime.close())); mediaServices.splice(0).forEach((media) => media.close()); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function setup() {
  const root = await mkdtemp(path.join(process.env.TMPDIR ?? tmpdir(), 'cutroom-speech-')); roots.push(root); const home = path.join(root, 'home'); await mkdir(home);
  const store = await SettingsStore.load(home); const media = new MediaService({ resolveTool: async () => '/fake', url: (_id, rel) => `http://127.0.0.1/${rel}` }); mediaServices.push(media);
  const runtime = new WorkflowRuntime({ home, store, media, secrets: { get: async () => 'secret-only-header', set: async () => {}, delete: async () => {}, getExtension: async () => null, setExtension: async () => {}, deleteExtension: async () => {} }, compositionsRoot: path.join(root, 'builtins'), skillsRoot: path.join(root, 'skills'), compositionBaseUrl: 'http://127.0.0.1/k/token/', resolveTool: async () => '/fake', resolveModel: async () => '/model', emit: () => {} }); runtimes.push(runtime);
  const session = await runtime.projects.create({ parentGrant: (await runtime.projects.grants.issue(root, 'projectParent')).grantId, name: 'Speech', format: { aspect: '16:9', width: 320, height: 180, fps: 30 }, defaultEngine: 'hyperframes' });
  return { root, home, store, media, runtime, session };
}
const fixture = { result: { language: 'en' }, transcription: [{ text: ' Hello world', offsets: { from: 0, to: 1000 }, tokens: [{ text: '[_BEG_]', p: 1 }, { text: ' Hel', p: 0.8, offsets: { from: 0, to: 200 } }, { text: 'lo', p: 1, offsets: { from: 200, to: 400 } }, { text: ' world', p: 0.9, offsets: { from: 500, to: 1000 } }] }] };
describe('speech and captions', () => {
  it('uses millisecond offsets and joins timed subword tokens without fabricating timing', () => {
    expect(parseWhisper(fixture)).toEqual({ language: 'en', words: [{ text: 'Hello', start: 0, end: 0.4, confidence: 0.9 }, { text: 'world', start: 0.5, end: 1, confidence: 0.9 }] });
    expect(() => parseWhisper({ transcription: [{ text: 'two words', offsets: { from: 0, to: 100 } }] })).toThrow('word timing');
    expect(whisperArgs('/model', '/audio', '/out')).toEqual(['-m', '/model', '-f', '/audio', '-l', 'auto', '-ojf', '-ml', '1', '-sow', '-of', '/out']);
  });
  it('maps a trim and speed onto caption-local words and timeline duration', () => {
    const caption = captionsForClip({ type: 'clip', id: 'clip_abcdefghij', src: 'raw/a.mp4', start: 10, duration: 5, in: 5, out: 15, speed: 2, volume: 1, muted: false, createdBy: 'user', userEdited: [] }, [{ text: 'outside', start: 4, end: 5 }, { text: 'Hello', start: 5, end: 7 }, { text: 'end', start: 14, end: 15 }, { text: 'outside', start: 15, end: 16 }]);
    expect(caption).toMatchObject({ start: 10, duration: 5 }); expect(caption.words.map(({ text, start, end }) => ({ text, start, end }))).toEqual([{ text: 'Hello', start: 0, end: 1 }, { text: 'end', start: 4.5, end: 5 }]);
  });
  it('grants only app main-frame audio requests', () => {
    const request = { permission: 'media', origin: 'app://cutroom/', mainFrame: true, mediaTypes: ['audio'] };
    expect(allowAudioPermission(request)).toBe(true);
    for (const patch of [{ mainFrame: false }, { mediaTypes: ['audio', 'video'] }, { mediaTypes: ['video'] }, { mediaTypes: [] }, { permission: 'geolocation' }, { origin: 'https://evil.example' }]) expect(allowAudioPermission({ ...request, ...patch })).toBe(false);
    expect(allowAudioPermission({ ...request, origin: 'http://127.0.0.1:5173/' }, 'http://127.0.0.1:5173')).toBe(true);
  });
  it('does not expose the next project timeline before the media root and project identity switch', async () => {
    const { runtime, media, root } = await setup(); const bind = media.bindProject.bind(media); let checked = false;
    vi.spyOn(media, 'bindProject').mockImplementation(async (id, folder) => { checked = true; expect(() => runtime.timeline()).toThrow('project is switching'); return bind(id, folder); });
    const next = await runtime.projects.create({ parentGrant: (await runtime.projects.grants.issue(root, 'projectParent')).grantId, name: 'Next', format: { aspect: '16:9', width: 320, height: 180, fps: 30 }, defaultEngine: 'hyperframes' });
    expect(checked).toBe(true); expect(runtime.timeline().root).toBe(next.rootPath); expect(runtime.projects.current()?.project.id).toBe(next.project.id);
  });
  it('caches transcripts, applies captions once, and cleans temporary WAVs on failure', async () => {
    const { runtime, session, home } = await setup(); await writeFile(path.join(session.rootPath, 'raw/a.mp4'), 'source');
    const client = new ElevenLabsClient({ connected: () => false, key: async () => null });
    const run = vi.fn<RunCommand>(async (_binary, args) => { if (args.includes('-ojf')) await writeFile(`${args[args.indexOf('-of') + 1]}.json`, JSON.stringify(fixture)); else await writeFile(args.at(-1)!, 'wav'); return { code: 0, stdout: '' }; });
    const service = new TranscriptsService({ runtime, home, client, resolveTool: async () => '/fake', resolveModel: async () => '/model', run });
    const job = await service.start({ rel: 'raw/a.mp4', engine: 'whisper' }); expect((await runtime.jobs.wait(job.jobId)).status).toBe('done'); expect((await service.get('raw/a.mp4'))?.words).toHaveLength(2);
    const cached = await service.start({ rel: 'raw/a.mp4', engine: 'whisper' }); expect((await runtime.jobs.wait(cached.jobId)).result).toMatchObject({ cached: true }); expect(run).toHaveBeenCalledTimes(2);
    await runtime.timeline().apply([{ type: 'addItem', trackId: 'video', item: { type: 'clip', id: 'clip_abcdefghij', src: 'raw/a.mp4', start: 0, duration: 1, in: 0, out: 1, speed: 1, volume: 1, muted: false, createdBy: 'user', userEdited: [] } }], { actor: 'user', label: 'Add clip' });
    // Use this service's cache via the runtime service, which shares the managed cache path.
    const revision = runtime.timeline().state().revision; await runtime.transcripts.captions('clip_abcdefghij'); expect(runtime.timeline().state().revision).toBe(revision + 1);
    expect(await readdir(path.join(session.rootPath, 'work/transcripts/tmp'))).toEqual([]);
    await expect(service.start({ rel: 'raw/a.mp4', engine: 'scribe' })).rejects.toMatchObject({ code: 'invalid_request' });
    const missing = new TranscriptsService({ runtime, home, client, resolveTool: async (name) => { if (name === 'whisper-cli') throw new Error('Missing binary'); return '/ffmpeg'; }, resolveModel: async () => '/model' }); await expect(missing.start({ rel: 'raw/a.mp4', engine: 'whisper' })).rejects.toMatchObject({ code: 'unavailable', message: expect.stringContaining('Settings → Tools') });
    run.mockImplementationOnce(async () => { throw new Error('Decode failed'); }); await expect(service.voice({ audio: new Uint8Array([1]), mime: 'audio/wav', engine: 'whisper' })).rejects.toThrow('Decode failed'); expect(await readdir(path.join(home, 'cache/voice'))).toEqual([]);
  });
});
describe('ElevenLabs main-only requests', () => {
  it('keeps the key in headers, maps Scribe probabilities and rejects disconnected use', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(new Uint8Array([1, 2, 3]))); const client = new ElevenLabsClient({ key: async () => 'secret-only-header', connected: () => true, fetch: fetcher });
    expect(await client.generate({ kind: 'tts', voiceId: 'voice', text: 'hello' })).toEqual(new Uint8Array([1, 2, 3]));
    const [url, init] = fetcher.mock.calls[0]!; expect(url).toBe('https://api.elevenlabs.io/v1/text-to-speech/voice?output_format=mp3_44100_128'); expect(init?.headers).toMatchObject({ 'xi-api-key': 'secret-only-header' }); expect(JSON.stringify(init?.body)).not.toContain('secret');
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ language_code: 'en', words: [{ type: 'word', text: 'Hi', start: 0, end: 1, logprob: -0.5 }] }))); expect((await client.transcribe(new Uint8Array([1]), 'scribe_v2')).words[0]?.confidence).toBeCloseTo(Math.exp(-0.5));
    await expect(new ElevenLabsClient({ key: async () => null, connected: () => false }).generate({ kind: 'music', text: 'song', durationSec: 3 })).rejects.toMatchObject({ code: 'invalid_request' });
  });
  it.each([false, true])('publishes mocked HTTP audio and places it once unless the timeline changed (stale=%s)', async (stale) => {
    const { runtime, media, session } = await setup(); vi.spyOn(media, 'sourceDurations').mockResolvedValue({});
    const probe = vi.spyOn(media, 'probeFile').mockResolvedValue({ duration: 1.2, width: null, height: null, fps: null, vcodec: null, acodec: 'mp3', channels: 1, sampleRate: 44100, bitrate: 128000, size: 3, hasAlpha: false });
    const fetcher = vi.fn<typeof fetch>(async () => { if (stale) await runtime.timeline().apply([{ type: 'setTrack', trackId: 'music', name: 'My music' }], { actor: 'user', label: 'Rename track' }); return new Response(new Uint8Array([1, 2, 3])); });
    const client = new ElevenLabsClient({ key: async () => 'secret-only-header', connected: () => true, fetch: fetcher }); const audio = new AudioService({ runtime, media, client, resolveTool: async () => '/fake' });
    const first = await audio.generate({ kind: 'tts', text: 'hello', voiceId: 'voice', placement: { time: 0.5, track: 'voiceover' } }, { actor: 'agent:test', requestId: 'voice-request' }); const done = await runtime.jobs.wait(first.jobId);
    expect(done.status, JSON.stringify(done.error)).toBe(stale ? 'failed' : 'done'); const provenance = JSON.parse((await readFile(path.join(session.rootPath, '.cutroom/provenance.jsonl'), 'utf8')).trim()); expect(await readFile(path.join(session.rootPath, provenance.rel))).toEqual(Buffer.from([1, 2, 3]));
    const items = runtime.timeline().state().doc.tracks.find((track) => track.kind === 'voiceover')!.items; expect(items).toHaveLength(stale ? 0 : 1);
    if (!stale) { expect(items[0]).toMatchObject({ start: 0.5, duration: 1.2, src: provenance.rel, createdBy: 'agent:test' }); const history = JSON.parse((await readFile(path.join(session.rootPath, '.cutroom/history.jsonl'), 'utf8')).trim()); expect(history).toMatchObject({ actor: 'agent', requestId: 'voice-request' }); }
    else expect(done.error?.code).toBe('conflict');
    expect(fetcher.mock.calls[0]![1]?.headers).toMatchObject({ 'xi-api-key': 'secret-only-header' }); expect(JSON.stringify(done)).not.toContain('secret-only-header'); expect(JSON.stringify(provenance)).not.toContain('secret-only-header'); expect(await readdir(path.join(session.rootPath, 'work/audio'))).toEqual([]); probe.mockRestore();
  });
  it('generates an exclusive output and prompt-hash provenance without secrets', async () => {
    const { runtime, store, session } = await setup(); await store.update((settings) => { settings.accounts.elevenlabs.status = 'connected'; });
    const spy = vi.spyOn(runtime.elevenlabs, 'generate').mockResolvedValue(new Uint8Array([1, 2, 3]));
    expect(runtime.audio.estimate({ kind: 'tts', text: 'hello' })).toEqual({ credits: 5 }); expect(runtime.audio.estimate({ kind: 'music' })).toEqual({ credits: null });
    const first = await runtime.audio.generate({ kind: 'tts', text: 'hello', voiceId: 'voice' }); const result = await runtime.jobs.wait(first.jobId); expect(result.status).toBe('done'); const rel = (result.result as { rel: string }).rel; expect(rel).toMatch(/^audio\/tts\/tts-.*\.mp3$/); expect(await readFile(path.join(session.rootPath, rel))).toEqual(Buffer.from([1, 2, 3]));
    const provenance = await readFile(path.join(session.rootPath, '.cutroom/provenance.jsonl'), 'utf8'); expect(provenance).toContain('textHash'); expect(provenance).not.toContain('hello'); expect(provenance).not.toContain('secret-only-header'); expect(JSON.stringify(result)).not.toContain('secret-only-header'); spy.mockRestore();
  });
});
