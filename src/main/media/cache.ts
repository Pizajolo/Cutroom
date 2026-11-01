import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveInProject } from '../fs/safePath';
import { mediaFailure, type ToolResolver } from './process';

export interface MediaContext {
  root: string;
  resolveTool: ToolResolver;
  url: (rel: string) => string;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
}
export async function sourceKey(context: MediaContext, rel: string, operation: string, tool: 'ffmpeg' | 'ffprobe'): Promise<{ file: string; key: string; size: number }> {
  const file = await resolveInProject(context.root, rel);
  const info = await stat(file);
  if (!info.isFile()) throw mediaFailure('invalid_request', 'Expected a regular media file.', 'invalid_file');
  const executable = await context.resolveTool(tool);
  const toolInfo = await stat(executable);
  const key = createHash('sha256').update(JSON.stringify([operation, file, info.size, info.mtimeMs, info.ctimeMs, executable, toolInfo.size, toolInfo.mtimeMs])).digest('hex');
  return { file, key, size: info.size };
}
export function cacheRel(key: string, suffix: string): string { return `work/.cutroom-media/${key}.${suffix}`; }
async function cachePath(context: MediaContext, rel: string, write = false): Promise<string> {
  if (!/^work\/\.cutroom-media\/[a-f0-9]{64}\.[a-z.]+$/.test(rel)) throw mediaFailure('forbidden', 'Invalid media cache path.', 'invalid_cache');
  const file = await resolveInProject(context.root, rel, { write });
  if (file !== path.join(await realpath(context.root), rel)) throw mediaFailure('forbidden', 'Media caches cannot use symlink aliases.', 'invalid_cache');
  return file;
}
export async function readCache(context: MediaContext, rel: string): Promise<unknown> {
  try {
    const file = await cachePath(context, rel);
    const info = await stat(file); if (!info.isFile() || info.size > 64 * 1024 * 1024) return undefined;
    return JSON.parse(await readFile(file, 'utf8')) as unknown;
  } catch { return undefined; }
}
export async function publishFile(context: MediaContext, rel: string, source: string): Promise<void> {
  let target = await cachePath(context, rel, true);
  await mkdir(path.dirname(target), { recursive: true });
  target = await cachePath(context, rel, true);
  try { if (!(await lstat(target)).isFile()) throw mediaFailure('forbidden', 'Invalid media cache target.', 'invalid_cache'); }
  catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
  const temporary = `${target}.${randomUUID()}.partial`;
  try {
    await copyFile(source, temporary, constants.COPYFILE_EXCL);
    await cachePath(context, rel, true);
    await rename(temporary, target);
  } finally { await rm(temporary, { force: true }); }
}
export async function writeCache(context: MediaContext, rel: string, value: unknown): Promise<void> {
  let target = await cachePath(context, rel, true);
  await mkdir(path.dirname(target), { recursive: true });
  target = await cachePath(context, rel, true);
  const temporary = `${target}.${randomUUID()}.partial`;
  try {
    await writeFile(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
    await cachePath(context, rel, true);
    await rename(temporary, target);
  } finally { await rm(temporary, { force: true }); }
}
