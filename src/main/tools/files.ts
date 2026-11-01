import { randomUUID, createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, open, realpath, rename, rm, link } from 'node:fs/promises';
import path from 'node:path';

export const isMissing = (error: unknown): boolean => error instanceof Error && 'code' in error && error.code === 'ENOENT';
export const contained = (root: string, target: string): boolean => { const rel = path.relative(root, target); return rel === '' || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`)); };
// Only internally validated names are accepted. Check symlinks independently of names.
export async function managedDirectory(home: string, ...parts: string[]): Promise<string> {
  await mkdir(home, { recursive: true, mode: 0o700 });
  const base = await realpath(home); let current = base;
  for (const part of parts) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(part) || part === '..') throw new Error('Invalid managed directory name.');
    current = path.join(current, part);
    try { await mkdir(current, { mode: 0o700 }); } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error; }
    if (!(await lstat(current)).isDirectory() || await realpath(current) !== current || !contained(base, current)) throw new Error('Managed directory is not contained.');
  }
  return current;
}
export async function sha256(file: string): Promise<string> {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { if (!(await handle.stat()).isFile()) throw new Error('Not a regular file.'); const hash = createHash('sha256'); for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk); return hash.digest('hex'); }
  finally { await handle.close(); }
}
export async function atomicJson(file: string, value: unknown): Promise<void> {
  try { if (!(await lstat(file)).isFile()) throw new Error('Refusing to replace a non-regular settings file.'); } catch (error) { if (!isMissing(error)) throw error; }
  const temp = path.join(path.dirname(file), `.state-${randomUUID()}.json`);
  try {
    const handle = await open(temp, 'wx', 0o600);
    try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`); await handle.sync(); } finally { await handle.close(); }
    await rename(temp, file);
  } finally { await rm(temp, { force: true }); }
}
export async function publishExclusive(source: string, target: string, expected: string): Promise<void> {
  // link is atomic and no-clobber; rename alone would overwrite a racing foreign file.
  try { await link(source, target); }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EXDEV') {
      const staged = path.join(path.dirname(target), `.publish-${randomUUID()}`);
      try { await copyFile(source, staged, constants.COPYFILE_EXCL); if (await sha256(staged) !== expected) throw new Error('Staged copy checksum mismatch.'); await publishExclusive(staged, target, expected); }
      finally { await rm(staged, { force: true }); }
      return;
    }
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
    if (!(await lstat(target)).isFile() || await sha256(target) !== expected) throw new Error('A different file already exists. Remove it explicitly before retrying.');
  }
}
