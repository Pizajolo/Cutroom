import { waveformSchema, type Waveform } from '../../shared/schema/media';
import { cacheRel, readCache, sourceKey, writeCache, type MediaContext } from './cache';
import { probe } from './probe';
import { INPUT_RESTRICTIONS, mediaFailure, runTool } from './process';

export class PeakAccumulator {
  readonly peaks: Waveform['peaks'] = [];
  private byte: number | undefined;
  private count = 0;
  private min = 1;
  private max = -1;
  samples = 0;
  add(chunk: Buffer): void {
    let offset = 0;
    if (this.byte !== undefined && chunk.length) {
      const word = this.byte | (chunk[0]! << 8); this.sample(word > 32767 ? word - 65536 : word); offset = 1; this.byte = undefined;
    }
    for (; offset + 1 < chunk.length; offset += 2) this.sample(chunk.readInt16LE(offset));
    if (offset < chunk.length) this.byte = chunk[offset];
  }
  private sample(value: number): void {
    if (this.peaks.length >= 1_000_000) throw new Error('Waveform is too large');
    const normalized = value / 32768;
    this.min = Math.min(this.min, normalized); this.max = Math.max(this.max, normalized); this.count++; this.samples++;
    if (this.count === 256) this.flush();
  }
  private flush(): void { if (this.count) this.peaks.push({ min: this.min, max: this.max }); this.count = 0; this.min = 1; this.max = -1; }
  finish(): Waveform['peaks'] { if (this.byte !== undefined) throw new Error('Truncated PCM sample'); this.flush(); return this.peaks; }
}
export function waveformArgs(file: string): string[] {
  return ['-v', 'error', '-nostdin', '-progress', 'pipe:2', ...INPUT_RESTRICTIONS, '-i', file, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '8000', '-c:a', 'pcm_s16le', '-f', 's16le', 'pipe:1'];
}
export async function waveform(context: MediaContext, rel: string): Promise<Waveform> {
  const metadata = await probe({ ...context, onProgress: undefined }, rel);
  if (!metadata.acodec) throw mediaFailure('invalid_request', 'This file has no audio stream.', 'no_audio');
  const { file, key } = await sourceKey(context, rel, 'waveform-v1', 'ffmpeg');
  const resultRel = cacheRel(key, 'waveform.json');
  const cached = waveformSchema.safeParse(await readCache(context, resultRel));
  if (cached.success) { context.onProgress?.(1); return { ...cached.data, rel: resultRel }; }
  context.onProgress?.(0);
  const accumulator = new PeakAccumulator();
  await runTool(context.resolveTool, 'ffmpeg', waveformArgs(file), { signal: context.signal, onProgress: (seconds) => context.onProgress?.(metadata.duration > 0 ? Math.min(0.99, seconds / metadata.duration) : 0), maxOutputBytes: 512_000_000, onOutput: (chunk) => accumulator.add(chunk) });
  const peaks = accumulator.finish();
  if (!accumulator.samples) throw mediaFailure('invalid_request', 'No audio samples were decoded.', 'no_audio');
  const result: Waveform = { rel: resultRel, duration: accumulator.samples / 8000, sampleRate: 8000, samplesPerPeak: 256, peaks };
  await writeCache(context, resultRel, result);
  context.onProgress?.(1);
  return result;
}
