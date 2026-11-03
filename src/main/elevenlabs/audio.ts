import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { nanoid } from 'nanoid';
import path from 'node:path';
import { IpcFailure, type InvokeReq } from '@shared/ipc/contract';
import { audioGenerateRequestSchema } from '@shared/schema/audio';
import { appendJson, managedPath } from '../fs/managed';
import { resolveInProject } from '../fs/safePath';
import { INPUT_RESTRICTIONS } from '../media/process';
import type { MediaService } from '../media/service';
import { runCommand } from '../process/run';
import type { WorkflowRuntime } from '../projects/runtime';
import type { ElevenLabsClient } from './client';

export class AudioService {
  constructor(private readonly options: { runtime: WorkflowRuntime; client: ElevenLabsClient; media: MediaService; resolveTool: (name: string) => Promise<string> }) {}
  estimate(request: InvokeReq<'audio.estimate'>): { credits: number | null } { return { credits: request.kind === 'tts' && request.text !== undefined ? Array.from(request.text).length : null }; }
  voices() { return this.options.client.voices(); }
  async generate(input: InvokeReq<'audio.generate'>, edit: { actor: 'user' | `agent:${string}`; requestId?: string } = { actor: 'user' }): Promise<{ jobId: string }> {
    const request = audioGenerateRequestSchema.parse(input); await this.options.client.requireConnected(); const session = this.options.runtime.projects.require();
    const revision = request.placement ? this.options.runtime.timeline().state().revision : undefined;
    const source = request.kind === 'isolate' ? await resolveInProject(session.rootPath, request.rel) : null;
    if (this.options.runtime.projects.current()?.project.id !== session.project.id) throw new IpcFailure({ code: 'conflict', message: 'The project changed. Retry audio generation.' });
    return this.options.runtime.jobs.enqueue(session, 'audio_generate', `ElevenLabs · ${request.kind}`, async (context) => {
      const base = await managedPath(session.rootPath, 'work/audio'); await mkdir(base, { recursive: true, mode: 0o700 }); const temporary = await mkdtemp(path.join(base, 'generation-')); let output: { path: string; dev: number; ino: number } | undefined;
      try {
        context.progress(0.05, 'Generating audio'); let bytes: Uint8Array;
        if (request.kind === 'isolate' && source) {
          const file = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); let original: Buffer;
          try { const info = await file.stat(); if (!info.isFile() || info.size > 100 * 1024 * 1024) throw new IpcFailure({ code: 'invalid_request', message: 'Audio isolation accepts regular files up to 100 MB.' }); original = await file.readFile(); } finally { await file.close(); }
          bytes = await this.options.client.isolate(original, context.signal);
          await writeFile(path.join(temporary, 'isolation.input'), bytes, { flag: 'wx', mode: 0o600 });
          const result = await runCommand(await this.options.resolveTool('ffmpeg'), ['-hide_banner', '-nostdin', '-n', ...INPUT_RESTRICTIONS, '-i', path.join(temporary, 'isolation.input'), '-vn', '-c:a', 'libmp3lame', '-b:a', '192k', path.join(temporary, 'audio.mp3')], { signal: context.signal, timeoutMs: 600_000 }); if (result.code !== 0) throw new IpcFailure({ code: 'unavailable', message: 'FFmpeg could not convert the isolated audio.' }); bytes = await readFile(path.join(temporary, 'audio.mp3'));
        } else if (request.kind !== 'isolate') bytes = await this.options.client.generate(request, context.signal);
        else throw new IpcFailure({ code: 'invalid_request', message: 'Select audio to isolate.' });
        if (!bytes.length || context.signal.aborted) throw new IpcFailure({ code: 'unavailable', message: 'Audio generation was cancelled or returned no audio.' });
        context.progress(0.9, 'Saving audio'); const rel = `audio/${request.kind}/${request.kind}-${randomUUID()}.mp3`; const destination = await managedPath(session.rootPath, rel); await mkdir(path.dirname(destination), { recursive: true });
        const staging = path.join(temporary, 'publish.mp3'); await writeFile(staging, bytes, { flag: 'wx', mode: 0o600 }); const identity = await lstat(staging); await link(staging, destination); output = { path: destination, dev: identity.dev, ino: identity.ino };
        if (context.signal.aborted) throw new Error('Cancelled');
        await appendJson(session.rootPath, '.cutroom/provenance.jsonl', { kind: request.kind, provider: 'elevenlabs', rel, ...(request.kind === 'tts' ? { voiceId: request.voiceId, model: request.model ?? null } : {}), textHash: 'text' in request ? createHash('sha256').update(request.text).digest('hex') : null, createdAt: new Date().toISOString() });
        output = undefined; this.options.media.notify([rel]);
        if (request.placement) {
          const timeline = this.options.runtime.timeline(); const state = timeline.state(); const track = state.doc.tracks.find((track) => track.kind === request.placement!.track)!;
          const probe = await this.options.media.probeFile(rel); const duration = Math.round(probe.duration * state.doc.format.fps) / state.doc.format.fps;
          if (!duration) throw new IpcFailure({ code: 'invalid_request', message: 'Generated audio has no usable duration. The file was kept in Audio.' });
          context.signal.throwIfAborted();
          if (this.options.runtime.projects.current()?.project.id !== session.project.id) throw new IpcFailure({ code: 'conflict', message: 'The project changed. Generated audio was kept in its original project.' });
          await timeline.apply([{ type: 'addItem', trackId: track.id, item: { type: 'audio', id: `audio_${nanoid(10)}`, src: rel, start: Math.round(request.placement.time * state.doc.format.fps) / state.doc.format.fps, duration, in: 0, out: probe.duration, gain: 0, fadeIn: 0, fadeOut: 0, createdBy: edit.actor, userEdited: [] } }], { ...edit, baseRevision: revision, label: 'Add generated audio' });
        }
        return { rel };
      } finally { try { if (output) { const info = await lstat(output.path).catch(() => null); if (info?.isFile() && info.dev === output.dev && info.ino === output.ino) await rm(output.path); } } finally { await rm(temporary, { recursive: true, force: true }); } }
    });
  }
}
