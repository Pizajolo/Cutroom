import { mediaProbeSchema, type MediaProbe } from '../../shared/schema/media';
import { cacheRel, readCache, sourceKey, writeCache, type MediaContext } from './cache';
import { INPUT_RESTRICTIONS, mediaFailure, runTool } from './process';

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const numeric = (value: unknown): number | null => {
  if ((typeof value !== 'string' && typeof value !== 'number') || value === '') return null;
  const number = Number(value); return Number.isFinite(number) && number >= 0 ? number : null;
};
const positive = (value: unknown): number | null => { const number = numeric(value); return number && number > 0 ? number : null; };
const integer = (value: unknown): number | null => { const number = positive(value); return number !== null && Number.isInteger(number) ? number : null; };
const text = (value: unknown): string | null => typeof value === 'string' ? value.slice(0, 256) : null;
export function parseFrameRate(value: unknown): number | null {
  if (typeof value === 'string' && value.includes('/')) {
    const [numerator, denominator, extra] = value.split('/');
    const a = positive(numerator); const b = positive(denominator);
    return a && b && extra === undefined && Number.isFinite(a / b) ? a / b : null;
  }
  return positive(value);
}
export function parseProbe(value: unknown, size: number): MediaProbe {
  const root = record(value); const format = record(root.format);
  const streams = Array.isArray(root.streams) ? root.streams.map(record) : [];
  const video = streams.find((stream) => stream.codec_type === 'video' && record(stream.disposition).attached_pic !== 1);
  const audio = streams.find((stream) => stream.codec_type === 'audio');
  if (!video && !audio) throw mediaFailure('invalid_request', 'No supported audio or video stream was found.', 'invalid_media');
  return mediaProbeSchema.parse({
    duration: numeric(format.duration) ?? Math.max(0, ...streams.map((stream) => numeric(stream.duration) ?? 0)),
    width: integer(video?.width), height: integer(video?.height),
    fps: parseFrameRate(video?.avg_frame_rate) ?? parseFrameRate(video?.r_frame_rate),
    vcodec: text(video?.codec_name), acodec: text(audio?.codec_name), channels: integer(audio?.channels),
    sampleRate: integer(audio?.sample_rate), bitrate: numeric(format.bit_rate), size,
    hasAlpha: /^(yuva|gbrap|rgba|bgra|argb|abgr|ya8|ya16)/.test(text(video?.pix_fmt) ?? ''),
  });
}
export function probeArgs(file: string): string[] { return ['-v', 'error', ...INPUT_RESTRICTIONS, '-show_format', '-show_streams', '-of', 'json', file]; }
export async function probe(context: MediaContext, rel: string): Promise<MediaProbe> {
  const { file, key, size } = await sourceKey(context, rel, 'probe-v1', 'ffprobe');
  const cached = mediaProbeSchema.safeParse(await readCache(context, cacheRel(key, 'probe.json')));
  if (cached.success) { context.onProgress?.(1); return cached.data; }
  context.onProgress?.(0);
  const result = await runTool(context.resolveTool, 'ffprobe', probeArgs(file), { signal: context.signal, timeoutMs: 30_000 });
  let value: unknown;
  try { value = JSON.parse(result.toString('utf8')) as unknown; }
  catch { throw mediaFailure('invalid_request', 'ffprobe returned invalid media metadata.', 'invalid_probe'); }
  const metadata = parseProbe(value, size);
  await writeCache(context, cacheRel(key, 'probe.json'), metadata);
  context.onProgress?.(1);
  return metadata;
}
