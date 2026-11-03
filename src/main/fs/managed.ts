import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { IpcFailure } from '@shared/ipc/errors';
import { resolveInProject } from './safePath';

export const isMissing = (error: unknown): boolean => error instanceof Error && 'code' in error && error.code === 'ENOENT';
export async function managedPath(root: string, rel: string): Promise<string> {
  const canonical = await realpath(root);
  const file = await resolveInProject(canonical, rel, { write: true, allowReadOnlyWrite: true });
  if (file !== path.join(canonical, rel)) throw new IpcFailure({ code: 'forbidden', message: 'Managed files cannot be symlink aliases.' });
  return file;
}
export async function readManagedBytes(root: string, rel: string, maxBytes = 32 * 1024 * 1024): Promise<Buffer> {
  const file = await open(await managedPath(root, rel), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > maxBytes) throw new IpcFailure({ code: 'invalid_request', message: 'The managed file is invalid or too large.' });
    return await file.readFile();
  } finally { await file.close(); }
}
export async function readManaged(root: string, rel: string, maxBytes = 32 * 1024 * 1024): Promise<string> { return (await readManagedBytes(root, rel, maxBytes)).toString('utf8'); }
export async function atomicWrite(root: string, rel: string, text: string): Promise<void> {
  const target = await managedPath(root, rel);
  try { if (!(await lstat(target)).isFile()) throw new IpcFailure({ code: 'forbidden', message: 'The managed target is not a regular file.' }); }
  catch (error) { if (!isMissing(error)) throw error; }
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = path.join(path.dirname(target), `.cutroom-write-${randomUUID()}`);
  try {
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(text); await file.sync(); } finally { await file.close(); }
    await rename(temporary, target);
    const directory = await open(path.dirname(target), constants.O_RDONLY);
    try { await directory.sync(); } finally { await directory.close(); }
  } finally { await rm(temporary, { force: true }); }
}
export const atomicJson = (root: string, rel: string, value: unknown): Promise<void> => atomicWrite(root, rel, `${JSON.stringify(value, null, 2)}\n`);
export async function appendJson(root: string, rel: string, value: unknown): Promise<void> {
  const target = await managedPath(root, rel);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const file = await open(target, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  try {
    if (!(await file.stat()).isFile()) throw new IpcFailure({ code: 'forbidden', message: 'The log is not a regular file.' });
    await file.writeFile(`${JSON.stringify(value)}\n`); await file.sync();
  } finally { await file.close(); }
}
