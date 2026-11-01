import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ToolRegistry, ToolUnavailable } from '../../src/main/tools/registry';
import { compareVersions, parseManifest, type ToolPin } from '../../src/main/tools/manifest';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
const pin = (version: string, contents: string, bundled = true): ToolPin => ({ name: 'ffmpeg', version, arch: 'arm64', bundled, sourceUrl: 'https://example.com/ffmpeg.zip', checksumUrl: 'https://example.com/ffmpeg.zip.sha256', archiveSha256: hash('archive'), sha256: hash(contents) });
async function fixture(): Promise<{ root: string; bundledRoot: string; home: string }> {
  const root = await mkdtemp(path.join(tmpdir(), 'cutroom-registry-test-')); temporary.push(root);
  const bundledRoot = path.join(root, 'resources/bin/arm64'); const home = path.join(root, 'home');
  await mkdir(bundledRoot, { recursive: true }); return { root, bundledRoot, home };
}
async function binary(file: string, contents: string): Promise<void> { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, contents); await chmod(file, 0o755); }
describe('verified tool registry', () => {
  it('caches verification, creates a managed symlink, and refuses a modified fixture binary', async () => {
    const dirs = await fixture(); const file = path.join(dirs.bundledRoot, 'ffmpeg'); await binary(file, 'fixture-v1');
    const registry = new ToolRegistry({ ...dirs, arch: 'arm64', manifest: { schemaVersion: 1, tools: [pin('1.0.0', 'fixture-v1')] } });
    await registry.initialize(); expect(await registry.resolve('ffmpeg')).toBe(file);
    expect(await readlink(path.join(dirs.home, 'bin/ffmpeg'))).toBe(file);
    const cache: unknown = JSON.parse(await readFile(path.join(dirs.home, 'tools-cache.json'), 'utf8')); expect(cache).toHaveProperty(file);
    await binary(file, 'fixture-v2');
    expect((await registry.list())[0]?.status).toBe('checksum_mismatch');
    await expect(registry.resolve('ffmpeg')).rejects.toBeInstanceOf(ToolUnavailable);
    await expect(lstat(path.join(dirs.home, 'bin/ffmpeg'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('prefers only a newer verified, application-pinned update and falls back on a bad update', async () => {
    const dirs = await fixture(); await binary(path.join(dirs.bundledRoot, 'ffmpeg'), 'bundled');
    const updated = path.join(dirs.home, 'tools/ffmpeg/2.0.0/ffmpeg'); await binary(updated, 'corrupt');
    const registry = new ToolRegistry({ ...dirs, arch: 'arm64', manifest: { schemaVersion: 1, tools: [pin('1.0.0', 'bundled'), pin('2.0.0', 'updated', false)] } });
    await registry.initialize(); expect((await registry.list())[0]?.source).toBe('bundled');
    await binary(updated, 'updated'); expect(await registry.resolve('ffmpeg')).toBe(updated);
    expect((await registry.list())[0]).toMatchObject({ source: 'updated', version: '2.0.0' });
  });
  it('never trusts unpinned executable bytes or symlinked binaries', async () => {
    const dirs = await fixture(); const file = path.join(dirs.bundledRoot, 'ffmpeg'); await binary(file, 'fixture');
    const unknownPin = { ...pin('1.0.0', 'fixture'), sha256: null };
    const registry = new ToolRegistry({ ...dirs, arch: 'arm64', manifest: { schemaVersion: 1, tools: [unknownPin] } });
    await registry.initialize(); expect((await registry.list())[0]?.status).toBe('checksum_mismatch');
    await rm(file); const outside = path.join(dirs.root, 'outside'); await binary(outside, 'fixture'); await symlink(outside, file);
    const symlinked = new ToolRegistry({ ...dirs, arch: 'arm64', manifest: { schemaVersion: 1, tools: [pin('1.0.0', 'fixture')] } });
    await symlinked.initialize(); await expect(symlinked.resolve('ffmpeg')).rejects.toBeInstanceOf(ToolUnavailable);
  });
  it('reports absent files and never replaces a user-created PATH file', async () => {
    const dirs = await fixture(); await mkdir(path.join(dirs.home, 'bin'), { recursive: true });
    const shortcut = path.join(dirs.home, 'bin/ffmpeg'); await writeFile(shortcut, 'user-owned');
    const registry = new ToolRegistry({ ...dirs, arch: 'arm64', manifest: { schemaVersion: 1, tools: [pin('1.0.0', 'fixture')] } });
    await registry.initialize(); expect((await registry.list())[0]?.status).toBe('missing');
    await binary(path.join(dirs.bundledRoot, 'ffmpeg'), 'fixture'); await registry.list();
    expect(await readFile(shortcut, 'utf8')).toBe('user-owned');
  });
  it('validates manifest names, URLs and digests; compares versions numerically', () => {
    expect(parseManifest({ schemaVersion: 1, tools: [pin('9.0.2', 'fixture')] }).tools).toHaveLength(1);
    expect(() => parseManifest({ schemaVersion: 1, tools: [{ ...pin('1.0.0', 'fixture'), name: '../ffmpeg' }] })).toThrow();
    expect(() => parseManifest({ schemaVersion: 1, tools: [{ ...pin('1.0.0', 'fixture'), sha256: 'invented' }] })).toThrow();
    expect(compareVersions('9.10.0', '9.2.0')).toBeGreaterThan(0);
  });
});
