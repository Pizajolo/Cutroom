import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { IpcFailure, type InvokeReq } from '@shared/ipc/contract';
import { transcriptSchema, voiceTranscribeRequestSchema, type Transcript } from '@shared/schema/transcripts';
import { captionsForClip } from '@shared/captions/generate';
import { atomicJson, isMissing, managedPath, readManaged } from '../fs/managed';
import { resolveInProject } from '../fs/safePath';
import { INPUT_RESTRICTIONS } from '../media/process';
import { runCommand, type RunCommand } from '../process/run';
import type { WorkflowRuntime } from '../projects/runtime';
import type { ElevenLabsClient } from '../elevenlabs/client';
import { parseWhisper, whisperArgs } from './whisper';

export class TranscriptsService {
  private readonly voices = new Map<AbortController, Promise<void>>();
  private closed = false;
  constructor(private readonly options: { runtime: WorkflowRuntime; home: string; client: ElevenLabsClient; resolveModel: (name: string) => Promise<string>; resolveTool: (name: string) => Promise<string>; run?: RunCommand }) {}
  private async source(rel: string) {
    const project = this.options.runtime.projects.require();
    const file = await resolveInProject(project.rootPath, rel);
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const info = await handle.stat(); if (!info.isFile()) throw new IpcFailure({ code: 'invalid_request', message: 'Choose a regular media file.' });
      return { project, file, key: createHash('sha256').update(JSON.stringify([rel, info.size, info.mtimeMs, info.ctimeMs, info.ino])).digest('hex') };
    } finally { await handle.close(); }
  }
  async get(rel: string): Promise<Transcript | null> {
    const source = await this.source(rel);
    try { return transcriptSchema.parse(JSON.parse(await readManaged(source.project.rootPath, `work/transcripts/${source.key}.json`))); }
    catch (error) { if (isMissing(error)) return null; throw error; }
  }
  private async prepare(engine: 'whisper' | 'scribe', model: string) {
    if (engine === 'scribe') await this.options.client.requireConnected();
    const resolve = async (name: string): Promise<string> => { try { return await this.options.resolveTool(name); } catch { throw new IpcFailure({ code: 'unavailable', message: `Install or repair ${name} in Settings → Tools before transcribing.` }); } };
    const ffmpeg = await resolve('ffmpeg');
    if (engine === 'scribe') return { ffmpeg, binary: null, modelPath: null };
    const binary = await resolve('whisper-cli');
    return { ffmpeg, binary, modelPath: await this.options.resolveModel(model) };
  }
  private async transcribe(file: string, temporary: string, engine: 'whisper' | 'scribe', model: string, tools: Awaited<ReturnType<TranscriptsService['prepare']>>, signal: AbortSignal, progress: (value: number) => void) {
    const run = this.options.run ?? runCommand; const wav = path.join(temporary, 'speech.wav');
    const decoded = await run(tools.ffmpeg, ['-hide_banner', '-nostdin', '-n', ...INPUT_RESTRICTIONS, '-i', file, '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav], { signal, timeoutMs: 3_600_000 });
    if (decoded.code !== 0) throw new IpcFailure({ code: 'unavailable', message: 'FFmpeg could not decode this audio.' });
    progress(0.15);
    if (engine === 'scribe') {
      const handle = await open(await managedPath(temporary, 'speech.wav'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const info = await handle.stat(); if (!info.isFile() || info.size > 100 * 1024 * 1024) throw new IpcFailure({ code: 'invalid_request', message: 'Scribe accepts decoded audio up to 100 MB.' });
        return await this.options.client.transcribe(await handle.readFile(), model, signal);
      } finally { await handle.close(); }
    }
    let tail = '';
    const output = path.join(temporary, 'words');
    const result = await run(tools.binary!, whisperArgs(tools.modelPath!, wav, output), { signal, timeoutMs: 24 * 3_600_000, onStderr: (chunk) => {
      tail = (tail + chunk).slice(-4096); for (const match of tail.matchAll(/progress\s*=\s*(\d{1,3})%/g)) progress(0.15 + Math.min(100, Number(match[1])) / 100 * 0.8);
    } });
    if (result.code !== 0) throw new IpcFailure({ code: 'unavailable', message: 'Whisper could not transcribe this audio. Check the selected model in Settings → Tools.' });
    return parseWhisper(JSON.parse(await readManaged(temporary, 'words.json')));
  }
  async start(request: InvokeReq<'transcripts.start'>): Promise<{ jobId: string }> {
    const source = await this.source(request.rel); const settings = this.options.runtime.settings.get();
    const model = request.model ?? (request.engine === 'whisper' ? settings.whisperModel : 'scribe_v2');
    const tools = await this.prepare(request.engine, model);
    if (this.options.runtime.projects.current()?.project.id !== source.project.project.id) throw new IpcFailure({ code: 'conflict', message: 'The project changed. Retry transcription.' });
    return this.options.runtime.jobs.enqueue(source.project, 'transcribe', `Transcribe · ${request.rel}`, async (context) => {
      const cached = await this.get(request.rel);
      if (cached?.engine === request.engine && cached.model === model) return { rel: request.rel, cached: true, transcript: cached };
      const base = await managedPath(source.project.rootPath, 'work/transcripts/tmp'); await mkdir(base, { recursive: true, mode: 0o700 });
      const temporary = await mkdtemp(path.join(base, 'transcription-'));
      try {
        const parsed = await this.transcribe(source.file, temporary, request.engine, model, tools, context.signal, (value) => context.progress(value, 'Transcribing'));
        context.signal.throwIfAborted();
        const current = await this.source(request.rel); if (current.key !== source.key || current.project.project.id !== source.project.project.id) throw new IpcFailure({ code: 'conflict', message: 'The source changed while transcribing. Retry with the current file.' });
        const transcript = transcriptSchema.parse({ rel: request.rel, engine: request.engine, model, ...parsed, createdAt: new Date().toISOString() });
        await atomicJson(source.project.rootPath, `work/transcripts/${source.key}.json`, transcript); return { rel: request.rel, transcript };
      } finally { await rm(temporary, { recursive: true, force: true }); }
    });
  }
  async captions(clipItemId: string, actor: 'user' | `agent:${string}` = 'user', requestId?: string) {
    const timeline = this.options.runtime.timeline(); const { doc, revision } = timeline.state();
    const clip = doc.tracks.flatMap((track) => track.items).find((item) => item.id === clipItemId);
    if (!clip || clip.type !== 'clip') throw new IpcFailure({ code: 'not_found', message: 'Select a video clip first.' });
    const transcript = await this.get(clip.src); if (!transcript) throw new IpcFailure({ code: 'invalid_request', message: 'Transcribe this clip before generating captions.' });
    const item = { ...captionsForClip(clip, transcript.words), createdBy: actor };
    if (!item.words.length) throw new IpcFailure({ code: 'invalid_request', message: 'There are no transcribed words inside this trim.' });
    return timeline.apply([{ type: 'addItem', trackId: doc.tracks.find((track) => track.kind === 'captions')!.id, item }], { actor, requestId, baseRevision: revision, label: 'Generate captions' });
  }
  async voice(input: InvokeReq<'voice.transcribe'>): Promise<{ text: string }> {
    const request = voiceTranscribeRequestSchema.parse(input); const settings = this.options.runtime.settings.get();
    const model = request.engine === settings.voiceInput.engine ? settings.voiceInput.model : request.engine === 'whisper' ? settings.whisperModel : 'scribe_v2';
    const tools = await this.prepare(request.engine, model); if (this.closed) throw new IpcFailure({ code: 'unavailable', message: 'The app is shutting down.' });
    const controller = new AbortController(); let finish!: () => void; const done = new Promise<void>((resolve) => { finish = resolve; }); this.voices.set(controller, done); let temporary: string | undefined;
    try {
      const base = await managedPath(this.options.home, 'cache/voice'); await mkdir(base, { recursive: true, mode: 0o700 });
      temporary = await mkdtemp(path.join(base, 'voice-'));
      const file = path.join(temporary, request.mime === 'audio/webm' ? 'input.webm' : 'input.wav'); await writeFile(file, request.audio, { flag: 'wx', mode: 0o600 });
      const parsed = await this.transcribe(file, temporary, request.engine, model, tools, controller.signal, () => {});
      return { text: parsed.words.map((word) => word.text).join(' ') };
    } finally { try { if (temporary) await rm(temporary, { recursive: true, force: true }); } finally { this.voices.delete(controller); finish(); } }
  }
  async close(): Promise<void> { this.closed = true; const active = [...this.voices]; for (const [controller] of active) controller.abort(); await Promise.all(active.map(([, done]) => done)); }
}
