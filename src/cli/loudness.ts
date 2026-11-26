// Loudness: measure a finished mix and level it to a target, the way a mastering engineer would before upload.
import { rename, rm } from 'node:fs/promises';
import { run } from './run';

export interface Loudness {
  /** Integrated loudness, LUFS. -Infinity for silence. */
  integrated: number;
  /** Highest true peak, dBTP. */
  truePeak: number;
  /** Loudness range, LU: how much the level moves between quiet and loud parts. */
  range: number;
  threshold: number;
  offset: number;
}

/** Peaks stay this far under full scale: lossy encoding on the platforms adds a little on top. */
export const TRUE_PEAK = -1;
const RANGE = 11;

const num = (value: unknown): number => (value === '-inf' ? -Infinity : Number(value));

/** Measure the loudness of a file's audio (EBU R128). Null when it has no audio. */
export async function measureLoudness(file: string, signal?: AbortSignal): Promise<Loudness | null> {
  let err = '';
  const args = ['-hide_banner', '-nostats', '-i', file, '-map', '0:a:0?', '-vn', '-af', `loudnorm=I=-14:TP=${TRUE_PEAK}:LRA=${RANGE}:print_format=json`, '-f', 'null', '-'];
  await run('ffmpeg', args, { signal, onStderr: (chunk) => (err += chunk) });
  // loudnorm prints its measurement as the last JSON object on stderr.
  const json = /\{[^{}]*"input_i"[^{}]*\}/.exec(err)?.[0];
  if (!json) return null;
  const m = JSON.parse(json) as Record<string, string>;
  return { integrated: num(m.input_i), truePeak: num(m.input_tp), range: num(m.input_lra), threshold: num(m.input_thresh), offset: num(m.target_offset) };
}

/**
 * Level a rendered video's audio to `target` LUFS with peaks under -1 dBTP, in place. The picture is copied, not
 * re-encoded. Measured first, then applied as one steady gain change (two-pass, linear), so nothing pumps.
 * Returns the loudness before levelling, or null when there was nothing to do (no audio, silence, already on target).
 */
export async function levelLoudness(file: string, target: number, signal?: AbortSignal): Promise<Loudness | null> {
  const m = await measureLoudness(file, signal);
  if (!m || !Number.isFinite(m.integrated) || m.integrated < -70) return null;
  if (Math.abs(m.integrated - target) < 0.5 && m.truePeak <= TRUE_PEAK) return null;
  const measured = `measured_I=${m.integrated}:measured_TP=${m.truePeak}:measured_LRA=${m.range}:measured_thresh=${m.threshold}:offset=${m.offset}`;
  const out = file.replace(/(\.\w+)?$/, '-level$1');
  try {
    await run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-map', '0:v:0?', '-map', '0:a:0', '-c:v', 'copy',
      // loudnorm works at 192 kHz inside; back to 48 kHz for the file.
      '-af', `loudnorm=I=${target}:TP=${TRUE_PEAK}:LRA=${RANGE}:${measured}:linear=true,aresample=48000`,
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-f', 'mp4', out,
    ], { signal });
    await rename(out, file);
  } catch (error) {
    await rm(out, { force: true });
    throw error;
  }
  return m;
}

/** "-14.2 LUFS" */
export const lufs = (value: number): string => (Number.isFinite(value) ? `${value.toFixed(1)} LUFS` : 'silent');
