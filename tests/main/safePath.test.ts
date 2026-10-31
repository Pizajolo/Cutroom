import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveInProject } from '@main/fs/safePath';

let temp: string; let root: string;
beforeEach(async () => {
  temp = await mkdtemp(path.join(tmpdir(), 'cutroom-path-test-'));
  root = path.join(temp, 'project');
  await mkdir(root); await mkdir(path.join(root, 'raw')); await mkdir(path.join(root, 'work'));
  await writeFile(path.join(root, 'raw', 'source.mp4'), 'unchanged');
});
afterEach(async () => { await rm(temp, { recursive: true }); });

describe('resolveInProject', () => {
  it.each(['../x', '/etc/passwd', 'a/%2e%2e/b', 'x\0y', 'a/%252e%252e/b', '..\\outside', 'C:\\private', '%2fetc/passwd', 'a//b'])('rejects %j before mutation', async (rel) => {
    await expect(resolveInProject(root, rel, { write: true })).rejects.toMatchObject({ code: 'forbidden' });
    expect(await readFile(path.join(root, 'raw', 'source.mp4'), 'utf8')).toBe('unchanged');
  });
  it('rejects a symlink to an existing outside folder', async () => {
    await mkdir(path.join(temp, 'outside')); await symlink(path.join(temp, 'outside'), path.join(root, 'escape'));
    await expect(resolveInProject(root, 'escape/new/deep.txt')).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('rejects a symlink to a sibling whose name shares the root prefix', async () => {
    await mkdir(`${root}-backup`); await symlink(`${root}-backup`, path.join(root, 'escape'));
    await expect(resolveInProject(root, 'escape/file.txt')).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('rejects a dangling symlink', async () => {
    await symlink(path.join(temp, 'missing'), path.join(root, 'dangling'));
    await expect(resolveInProject(root, 'dangling/file.txt')).rejects.toBeDefined();
  });
  it('denies source writes, including through an internal symlink alias', async () => {
    await expect(resolveInProject(root, 'raw/x.mp4', { write: true })).rejects.toMatchObject({ code: 'forbidden' });
    await symlink(path.join(root, 'raw'), path.join(root, 'alias'));
    await expect(resolveInProject(root, 'alias/x.mp4', { write: true })).rejects.toMatchObject({ code: 'forbidden' });
    expect(await readFile(path.join(root, 'raw', 'source.mp4'), 'utf8')).toBe('unchanged');
  });
  it('allows work outputs, source reads and explicit import writes', async () => {
    expect(await resolveInProject(root, 'work/notes.md', { write: true })).toBe(path.join(root, 'work/notes.md'));
    expect(await resolveInProject(root, 'raw/source.mp4')).toBe(path.join(root, 'raw/source.mp4'));
    expect(await resolveInProject(root, 'raw/new.mp4', { write: true, allowReadOnlyWrite: true })).toBe(path.join(root, 'raw/new.mp4'));
  });
});
