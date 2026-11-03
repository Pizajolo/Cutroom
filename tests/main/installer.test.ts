import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ToolRegistry } from '@main/tools/registry';
import { ToolInstaller } from '@main/tools/installer';
import { checksumFromText, download, type Fetch } from '@main/tools/download';
import { hasMachArchitecture } from '@main/tools/binary';
import type { ToolPin } from '@main/tools/manifest';
import { runCommand } from '@main/process/run';

const roots: string[] = []; const closers: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(closers.splice(0).map((close) => close())); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const hash = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
const macho = (arch = 'arm64'): Buffer => { const bytes = Buffer.alloc(64); bytes.writeUInt32LE(0xfeedfacf); bytes.writeUInt32LE(arch === 'arm64' ? 0x0100000c : 0x01000007, 4); return bytes; };
const response = (bytes: Uint8Array): Response => new Response(new Uint8Array(bytes));
function tool(bytes: Uint8Array, options: Partial<ToolPin> = {}): ToolPin { return { name: 'ffprobe', version: '9.0.2', arch: 'arm64', bundled: true, source: { url: 'https://download.test/binary', format: 'raw' }, checksum: { url: 'https://download.test/checksum', format: 'single' }, allowedHosts: ['download.test'], archiveSha256: hash(bytes), sha256: null, updatable: false, license: 'test', ...options }; }
async function fixture(pin: ToolPin, fetch: Fetch): Promise<{ home: string; registry: ToolRegistry; installer: ToolInstaller }> {
  const root = await mkdtemp(path.join(tmpdir(), 'cutroom-installer-test-')); roots.push(root);
  const home = path.join(root, 'home'); const bundledRoot = path.join(root, 'bundle'); await mkdir(bundledRoot);
  const registry = new ToolRegistry({ home, bundledRoot, arch: 'arm64', manifest: { schemaVersion: 2, models: [], tools: [pin] } }); await registry.initialize();
  const installer = new ToolInstaller({ registry, fetch, clearQuarantine: async () => {} }); closers.push(() => installer.close());
  return { home, registry, installer };
}
describe('tool downloads', () => {
  it('installs pinned raw bytes, records verification and does not download on the second launch', async () => {
    const bytes = macho(); const fetch = vi.fn<Fetch>(async () => response(bytes)); const pin = tool(bytes, { sha256: hash(bytes) });
    const { home, registry, installer } = await fixture(pin, fetch);
    await installer.ensureAll(); expect(fetch).toHaveBeenCalledOnce();
    expect((await registry.list())[0]).toMatchObject({ source: 'downloaded', status: 'ok', verification: 'pinned', install: null });
    expect(await readFile(await registry.resolve('ffprobe'))).toEqual(bytes);
    expect((await registry.installed.read()).records[0]).toMatchObject({ sha256: hash(bytes), archiveSha256: hash(bytes), verification: 'pinned' });
    const next = new ToolRegistry(registry.options); await next.initialize();
    const nextInstaller = new ToolInstaller({ registry: next, fetch }); closers.push(() => nextInstaller.close()); await nextInstaller.ensureAll();
    expect(fetch).toHaveBeenCalledOnce(); expect((await readdir(path.join(home, 'tools'))).some((name) => name.startsWith('.staging-'))).toBe(false);
  });
  it('extracts only the exact executable from a real ZIP archive', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cutroom-zip-test-')); roots.push(root);
    const bytes = macho(); const source = path.join(root, 'ffprobe'); const unrelated = path.join(root, 'unrelated'); const archive = path.join(root, 'fixture.zip');
    await writeFile(source, bytes); await writeFile(unrelated, 'must not be extracted');
    expect((await runCommand('/usr/bin/zip', ['-j', archive, source, unrelated])).code).toBe(0);
    const zipped = await readFile(archive);
    const pin = tool(zipped, { source: { url: 'https://download.test/archive.zip', format: 'zip', entry: 'ffprobe' }, sha256: hash(bytes) });
    const { installer, registry, home } = await fixture(pin, async () => response(zipped));
    await installer.install('ffprobe');
    expect(await readFile(await registry.resolve('ffprobe'))).toEqual(bytes);
    expect(await readdir(path.join(home, 'tools/ffprobe/9.0.2'))).toEqual(['ffprobe']);
    expect((await registry.list())[0]).toMatchObject({ status: 'ok', verification: 'pinned', install: null });
  });
  it('refuses redirects before contacting a non-allowlisted host', async () => {
    const fetch = vi.fn<Fetch>(async () => new Response(null, { status: 302, headers: { location: 'https://evil.test/stolen' } }));
    const { installer, home } = await fixture(tool(macho()), fetch);
    await expect(installer.install('ffprobe')).rejects.toMatchObject({ code: 'unavailable' });
    expect(fetch).toHaveBeenCalledOnce(); expect(await readdir(path.join(home, 'tools'))).toEqual([]);
  });
  it('rejects archive checksum mismatch before creating a version directory', async () => {
    const { installer, home, registry } = await fixture(tool(macho()), async () => response(macho('x64')));
    await expect(installer.install('ffprobe')).rejects.toMatchObject({ code: 'unavailable' });
    expect(await readdir(path.join(home, 'tools'))).toEqual([]);
    expect((await registry.list())[0]?.install).toMatchObject({ state: 'failed', error: expect.stringContaining('checksum') });
  });
  it('rejects wrong architecture even if the download checksum matches', async () => {
    const bytes = macho('x64'); const { installer, registry, home } = await fixture(tool(bytes), async () => response(bytes));
    await expect(installer.install('ffprobe')).rejects.toMatchObject({ code: 'unavailable' });
    await expect(registry.resolve('ffprobe')).rejects.toThrow(); expect(await readdir(path.join(home, 'tools'))).toEqual([]);
  });
  it('cancels a stalled stream and cleans its staging directory', async () => {
    let started = (): void => {}; const ready = new Promise<void>((resolve) => { started = resolve; });
    const fetch: Fetch = async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(macho())); started(); } }));
    const { installer, home, registry } = await fixture(tool(macho()), fetch);
    const done = installer.install('ffprobe'); const rejected = expect(done).rejects.toMatchObject({ code: 'unavailable' }); await ready;
    await installer.cancel('ffprobe'); await rejected;
    expect(await readdir(path.join(home, 'tools'))).toEqual([]); expect((await registry.list())[0]?.install).toBeNull();
  });
  it('reports tampered installed bytes and never overwrites them on retry', async () => {
    const bytes = macho(); const { installer, registry } = await fixture(tool(bytes), async () => response(bytes)); await installer.install('ffprobe');
    const file = await registry.resolve('ffprobe'); await writeFile(file, 'tampered executable');
    expect((await registry.list())[0]?.status).toBe('checksum_mismatch'); await expect(registry.resolve('ffprobe')).rejects.toThrow();
    await expect(installer.install('ffprobe')).rejects.toMatchObject({ code: 'unavailable' }); expect(await readFile(file, 'utf8')).toBe('tampered executable');
  });
  it('accepts a fat binary only when it contains the host architecture', () => {
    const bytes = Buffer.alloc(48); bytes.writeUInt32BE(0xcafebabe); bytes.writeUInt32BE(2, 4); bytes.writeUInt32BE(0x01000007, 8); bytes.writeUInt32BE(0x0100000c, 28);
    expect(hasMachArchitecture(bytes, 'arm64')).toBe(true); expect(hasMachArchitecture(bytes, 'x64')).toBe(true);
    expect(hasMachArchitecture(bytes.subarray(0, 32), 'arm64')).toBe(false);
  });
  it('times out on an inactive response body and enforces size limits', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cutroom-downloader-test-')); roots.push(root);
    const options = { url: 'https://download.test/binary', file: path.join(root, 'file'), policy: { allowedHosts: ['download.test'] }, limit: 64, signal: new AbortController().signal, inactivityMs: 10 };
    await expect(download({ ...options, fetch: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])); } })) })).rejects.toThrow('timed out');
    // The size assertion must not race the preceding 10 ms inactivity deadline under disk load.
    await expect(download({ ...options, inactivityMs: 30_000, file: path.join(root, 'large'), fetch: async () => new Response(new Uint8Array(65)) })).rejects.toThrow('size');
  });
});
describe('yt-dlp release updates', () => {
  const yt = (bytes: Uint8Array): ToolPin => tool(bytes, { name: 'yt-dlp', version: '2026.10.26', arch: 'universal', bundled: false, updatable: true, archiveSha256: null, checksum: { url: 'https://download.test/sums', format: 'sums', entry: 'yt-dlp_macos' }, allowedHosts: ['download.test', 'github.com'] });
  it.each(['a'.repeat(64) + '  wrong-file', 'a'.repeat(64) + '  yt-dlp_macos'])('refuses absent or mismatched sums (%s)', async (sums) => {
    const bytes = macho(); const fetch: Fetch = async (url) => String(url).endsWith('/sums') ? new Response(sums) : response(bytes);
    const { installer, registry } = await fixture(yt(bytes), fetch);
    await expect(installer.install('yt-dlp')).rejects.toMatchObject({ code: 'unavailable' }); await expect(registry.resolve('yt-dlp')).rejects.toThrow();
  });
  it('installs upstream-verified updates and retains the previous version', async () => {
    const bytes = macho(); const fetch = vi.fn<Fetch>(async (url) => {
      const value = String(url);
      if (value.includes('api.github.com')) return Response.json({ tag_name: '2026.11.01' });
      if (value.endsWith('/sums') || value.endsWith('/SHA2-256SUMS')) return new Response(`${hash(bytes)}  yt-dlp_macos\n`);
      return response(bytes);
    });
    const { installer, registry, home } = await fixture(yt(bytes), fetch); await installer.install('yt-dlp');
    expect((await registry.list())[0]?.verification).toBe('upstream');
    await expect(installer.checkUpdate('yt-dlp')).resolves.toEqual({ current: '2026.10.26', latest: '2026.11.01' });
    expect((await registry.list())[0]?.latestVersion).toBe('2026.11.01');
    await installer.update('yt-dlp'); expect((await registry.list())[0]).toMatchObject({ source: 'updated', version: '2026.11.01', verification: 'upstream', latestVersion: null });
    expect(await registry.resolve('yt-dlp')).toContain('2026.11.01'); expect(await readFile(path.join(home, 'tools/yt-dlp/2026.10.26/yt-dlp'))).toEqual(bytes);
    const before = fetch.mock.calls.length; await installer.checkUpdate('yt-dlp', true); expect(fetch).toHaveBeenCalledTimes(before);
  });
  it('ignores a malformed release tag and rejects updates for ffprobe', async () => {
    const { installer } = await fixture(yt(macho()), async () => Response.json({ tag_name: '../../bad' }));
    expect((await installer.checkUpdate('yt-dlp')).latest).toBeNull();
    const ff = await fixture(tool(macho()), async () => response(macho())); await expect(ff.installer.update('ffprobe')).rejects.toMatchObject({ code: 'invalid_request' });
  });
  it('parses only an exact, unique checksum entry', () => {
    expect(checksumFromText(`${hash('test')} *yt-dlp_macos\n`, 'sums', 'yt-dlp_macos')).toBe(hash('test'));
    expect(() => checksumFromText(`${hash('test')} yt-dlp_macos\n${hash('test')} yt-dlp_macos`, 'sums', 'yt-dlp_macos')).toThrow();
  });
});
