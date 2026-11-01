import { spawn } from 'node:child_process';
import { IpcFailure } from '../../shared/ipc/errors';
import { ToolUnavailable } from '../tools/registry';

export type ToolResolver = (name: 'ffmpeg' | 'ffprobe') => Promise<string>;
const active = new Set<{ cancel: () => void; finished: Promise<void> }>();
export async function stopMediaProcesses(): Promise<void> {
  const running = [...active]; for (const process of running) process.cancel();
  await Promise.all(running.map((process) => process.finished));
}
export interface ProcessOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  maxOutputBytes?: number;
  onOutput?: (chunk: Buffer) => void;
  onProgress?: (seconds: number) => void;
}
export const INPUT_RESTRICTIONS = ['-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm,avi,wav,aiff,mp3,flac,ogg,aac,image2,png_pipe,jpeg_pipe,webp_pipe,gif,bmp_pipe,tiff_pipe'];
export const mediaFailure = (code: 'invalid_request' | 'not_found' | 'forbidden' | 'internal', message: string, kind: string): IpcFailure => new IpcFailure({ code, message, details: { kind } });
export async function runTool(resolve: ToolResolver, name: 'ffmpeg' | 'ffprobe', args: readonly string[], options: ProcessOptions = {}): Promise<Buffer> {
  let executable: string;
  try { executable = await resolve(name); }
  catch (error) { if (error instanceof ToolUnavailable) throw mediaFailure('not_found', error.message, error.status); throw error; }
  if (options.signal?.aborted) throw mediaFailure('invalid_request', 'Media operation cancelled.', 'cancelled');
  return new Promise((resolveResult, reject) => {
    const child = spawn(executable, [...args], { shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = []; let bytes = 0; let progressBuffer = ''; let stopped: IpcFailure | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const kill = (): void => {
      try { if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM'); else child.kill('SIGTERM'); } catch { /* Already exited. */ }
      killTimer = setTimeout(() => { try { if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { /* Already exited. */ } }, 2000); killTimer.unref();
    };
    const stop = (failure: IpcFailure): void => { if (!stopped) { stopped = failure; kill(); } };
    const abort = (): void => stop(mediaFailure('invalid_request', 'Media operation cancelled.', 'cancelled'));
    let finish = (): void => undefined;
    const entry = { cancel: abort, finished: new Promise<void>((resolve) => { finish = resolve; }) };
    active.add(entry);
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    const timeout = setTimeout(() => stop(mediaFailure('internal', `${name} timed out.`, 'timeout')), options.timeoutMs ?? 600_000); timeout.unref();
    child.stdout.on('data', (chunk: Buffer) => {
      if (stopped) return;
      bytes += chunk.length;
      if (bytes > (options.maxOutputBytes ?? 8 * 1024 * 1024)) { stop(mediaFailure('invalid_request', 'Media output is too large.', 'output_limit')); return; }
      try { if (options.onOutput) options.onOutput(chunk); else chunks.push(chunk); }
      catch { stop(mediaFailure('invalid_request', 'Media output is too large or invalid.', 'output_limit')); }
    });
    // FFmpeg progress goes to stderr. Do not forward stderr: it may contain source paths or arbitrary metadata.
    child.stderr.on('data', (chunk: Buffer) => {
      progressBuffer = (progressBuffer + chunk.toString('utf8')).slice(-16_384);
      const lines = progressBuffer.split('\n'); progressBuffer = lines.pop() ?? '';
      for (const line of lines) {
        const match = /^out_time_us=(\d+)$/.exec(line.trim());
        if (match?.[1]) {
          try { options.onProgress?.(Number(match[1]) / 1_000_000); }
          catch { stop(mediaFailure('internal', 'Media progress could not be reported.', 'progress_failed')); }
        }
      }
    });
    const cleanup = (): void => { clearTimeout(timeout); if (killTimer) clearTimeout(killTimer); options.signal?.removeEventListener('abort', abort); active.delete(entry); finish(); };
    child.once('error', () => { cleanup(); reject(mediaFailure('internal', `${name} could not be started.`, 'spawn_failed')); });
    child.once('close', (code) => {
      cleanup();
      if (stopped) reject(stopped);
      else if (code !== 0) reject(mediaFailure('invalid_request', `${name} could not process this media file.`, 'process_failed'));
      else resolveResult(Buffer.concat(chunks));
    });
  });
}
