import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rm, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import type { ImportDestination } from '../../shared/schema/media';
import { resolveInProject } from '../fs/safePath';
import { mediaFailure } from './process';

export function importName(file: string): string {
  let name = path.basename(file).normalize('NFC').replace(/[\p{Cc}\\/%:]/gu, '_');
  while (Buffer.byteLength(name) > 220) name = Array.from(name).slice(0, -1).join('');
  return !name || name === '.' || name === '..' ? 'media' : name;
}
export async function importPaths(root: string, paths: readonly string[], destination: ImportDestination, options: { signal?: AbortSignal; onProgress?: (completed: number, total: number) => void; firstSuffix?: number } = {}): Promise<string[]> {
  if (!['raw', 'references', 'assets'].includes(destination) || !paths.length || paths.length > 100) throw mediaFailure('invalid_request', 'Invalid media import request.', 'invalid_import');
  const sources: { handle: FileHandle; name: string; size: number; ctimeMs: number }[] = [];
  const created: { rel: string; ino: number; dev: number }[] = [];
  try {
    // Validate every source before the first project mutation. Keep descriptors open, so path replacements cannot change the imported bytes.
    for (const file of paths) {
      if (!path.isAbsolute(file) || file.includes('\0')) throw mediaFailure('invalid_request', 'Imports require absolute local file paths.', 'invalid_import');
      const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const info = await handle.stat();
      sources.push({ handle, name: importName(file), size: info.size, ctimeMs: info.ctimeMs });
      if (!info.isFile()) throw mediaFailure('invalid_request', 'Only regular files can be imported.', 'invalid_import');
    }
    if (options.signal?.aborted) throw mediaFailure('invalid_request', 'Import cancelled.', 'cancelled');
    const canonicalRoot = await realpath(root);
    const folder = await resolveInProject(root, destination, { write: true, allowReadOnlyWrite: true });
    if (folder !== path.join(canonicalRoot, destination)) throw mediaFailure('forbidden', 'Import destinations cannot be symlink aliases.', 'invalid_destination');
    await mkdir(folder, { recursive: true });
    const totalBytes = sources.reduce((sum, source) => sum + source.size, 0); let completedBytes = 0;
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    for (const source of sources) {
      if (options.signal?.aborted) throw mediaFailure('invalid_request', 'Import cancelled.', 'cancelled');
      const parsed = path.parse(source.name);
      for (let suffix = 0; ; suffix++) {
        const name = suffix ? `${parsed.name}-${suffix + (options.firstSuffix ?? 1) - 1}${parsed.ext}` : source.name;
        const rel = `${destination}/${name}`;
        const target = await resolveInProject(root, rel, { write: true, allowReadOnlyWrite: true });
        if (target !== path.join(canonicalRoot, rel)) throw mediaFailure('forbidden', 'Import targets cannot be symlink aliases.', 'invalid_destination');
        let output: FileHandle;
        try { output = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
        catch (error) { if (error instanceof Error && 'code' in error && error.code === 'EEXIST') continue; throw error; }
        const identity = await output.stat(); created.push({ rel, ino: identity.ino, dev: identity.dev });
        try {
          let position = 0;
          for (;;) {
            if (options.signal?.aborted) throw mediaFailure('invalid_request', 'Import cancelled.', 'cancelled');
            const { bytesRead } = await source.handle.read(buffer, 0, buffer.length, position);
            if (!bytesRead) break;
            for (let offset = 0; offset < bytesRead;) {
              const { bytesWritten } = await output.write(buffer, offset, bytesRead - offset, position + offset);
              if (!bytesWritten) throw mediaFailure('internal', 'The imported file could not be written.', 'write_failed');
              offset += bytesWritten;
            }
            position += bytesRead; completedBytes += bytesRead;
            options.onProgress?.(Math.min(completedBytes, totalBytes), Math.max(1, totalBytes));
          }
          const after = await source.handle.stat();
          if (after.size !== source.size || after.ctimeMs !== source.ctimeMs) throw mediaFailure('invalid_request', 'Source media changed during import; please try again.', 'source_changed');
          await output.sync();
        } finally { await output.close(); }
        break;
      }
    }
    options.onProgress?.(1, 1);
    return created.map(({ rel }) => rel);
  } catch (error) {
    // Only remove files this invocation exclusively created, if their identity still matches.
    for (const entry of created) {
      const target = await resolveInProject(root, entry.rel, { write: true, allowReadOnlyWrite: true });
      const identity = await lstat(target).catch(() => undefined);
      if (identity?.isFile() && identity.ino === entry.ino && identity.dev === entry.dev) await rm(target, { force: true });
    }
    throw error;
  } finally { await Promise.all(sources.map(({ handle }) => handle.close())); }
}
