import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { thumbnailSchema, type MediaProbe, type Thumbnails } from '../../shared/schema/media';
import { resolveInProject } from '../fs/safePath';
import { cacheRel, publishFile, readCache, sourceKey, writeCache, type MediaContext } from './cache';
import { probe } from './probe';
import { INPUT_RESTRICTIONS, mediaFailure, runTool } from './process';

export function thumbnailLayout(metadata: MediaProbe): Omit<Thumbnails, 'imageRel' | 'imageUrl'> {
  if (!metadata.width || !metadata.height) throw mediaFailure('invalid_request', 'This file has no video frames.', 'no_video');
  const frameHeight = 160; const frameWidth = Math.max(2, Math.round(metadata.width / metadata.height * frameHeight / 2) * 2);
  if (frameWidth > 2048) throw mediaFailure('invalid_request', 'The media aspect ratio is too wide for a thumbnail sprite.', 'thumbnail_limit');
  const interval = Math.max(5, metadata.duration / 100); const count = Math.max(1, Math.min(100, Math.ceil(metadata.duration / interval)));
  const columns = Math.min(10, count); const rows = Math.ceil(count / columns);
  const frames = Array.from({ length: count }, (_, index) => ({ time: index * interval, x: index % columns * frameWidth, y: Math.floor(index / columns) * frameHeight, w: frameWidth, h: frameHeight }));
  return { interval, count, columns, rows, frameWidth, frameHeight, frames };
}
export function thumbnailArgs(file: string, output: string, metadata: MediaProbe): string[] {
  const layout = thumbnailLayout(metadata);
  const filters = [
    ...(metadata.duration > 0 ? [`fps=fps=1/${layout.interval}:start_time=0:round=up:eof_action=pass`] : []),
    `scale=${layout.frameWidth}:${layout.frameHeight}`,
    `tile=${layout.columns}x${layout.rows}:nb_frames=${layout.count}`,
  ];
  return ['-v', 'error', '-nostdin', '-progress', 'pipe:2', ...INPUT_RESTRICTIONS, '-noautorotate', '-i', file, '-map', '0:V:0', '-vf', filters.join(','), '-frames:v', '1', '-q:v', '3', '-n', output];
}
export async function thumbnails(context: MediaContext, rel: string): Promise<Thumbnails> {
  const metadata = await probe({ ...context, onProgress: undefined }, rel);
  context.onProgress?.(0);
  const { file, key } = await sourceKey(context, rel, 'thumbnails-v1', 'ffmpeg');
  const imageRel = cacheRel(key, 'sprite.jpg'); const imageUrl = context.url(imageRel);
  const cached = thumbnailSchema.safeParse(await readCache(context, cacheRel(key, 'thumbnails.json')));
  if (cached.success) {
    try { if ((await stat(await resolveInProject(context.root, imageRel))).size > 0) { context.onProgress?.(1); return { ...cached.data, imageRel, imageUrl }; } } catch { /* Regenerate absent sprites. */ }
  }
  const temporary = await mkdtemp(path.join(tmpdir(), 'cutroom-thumbnails-'));
  try {
    const output = path.join(temporary, 'sprite.jpg');
    await runTool(context.resolveTool, 'ffmpeg', thumbnailArgs(file, output, metadata), { signal: context.signal, onProgress: (seconds) => context.onProgress?.(metadata.duration > 0 ? Math.min(0.99, seconds / metadata.duration) : 0) });
    if (!(await stat(output)).size) throw mediaFailure('invalid_request', 'No thumbnail frames were generated.', 'no_video');
    await publishFile(context, imageRel, output);
    const result = { ...thumbnailLayout(metadata), imageRel, imageUrl };
    await writeCache(context, cacheRel(key, 'thumbnails.json'), result);
    context.onProgress?.(1);
    return result;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
