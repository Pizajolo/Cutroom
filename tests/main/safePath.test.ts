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
  it.each(['../x', '/etc/passwd', 'a/../b', 'x\0y', 'a/./b', '..\\outside', 'C:\\private', '//etc/passwd', 'a//b'])('rejects %j before mutation', async (rel) => {
    await expect(resolveInProject(root, rel, { write: true })).rejects.toMatchObject({ code: 'forbidden' });
    expect(await readFile(path.join(root, 'raw', 'source.mp4'), 'utf8')).toBe('unchanged');
  });
  it('resolves percent signs and URL-looking names literally, without aliasing distinct files', async () => {
    const names = ['100% done.mp4', 'take%20one.mp4', 'take one.mp4', '%2e%2e.mp4', '%00.mp4'];
    for (const name of names) await writeFile(path.join(root, 'raw', name), name);
    for (const name of names) {
      const resolved = await resolveInProject(root, `raw/${name}`);
      expect(resolved).toBe(path.join(root, 'raw', name));
      expect(await readFile(resolved, 'utf8')).toBe(name);
      await expect(resolveInProject(root, `raw/${name}`, { write: true })).rejects.toMatchObject({ code: 'forbidden' });
    }
    await mkdir(path.join(root, '%2e%2e'));
    expect(await resolveInProject(root, '%2e%2e/new.txt', { write: true })).toBe(path.join(root, '%2e%2e/new.txt'));
    await mkdir(path.join(temp, 'outside'));
    await symlink(path.join(temp, 'outside'), path.join(root, '%20escape'));
    await expect(resolveInProject(root, '%20escape/new.txt', { write: true })).rejects.toMatchObject({ code: 'forbidden' });
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
