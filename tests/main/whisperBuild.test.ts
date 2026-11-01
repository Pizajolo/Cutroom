import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildWhisper, validateTarListing } from '@main/tools/whisperBuild';
import type { Fetch } from '@main/tools/download';
import type { RunCommand } from '@main/process/run';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function fixture(sourceSha256: string | null): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'cutroom-whisper-build-test-')); roots.push(root); await mkdir(path.join(root, 'resources'));
  await writeFile(path.join(root, 'resources/tools-manifest.json'), JSON.stringify({ schemaVersion: 2, models: [], tools: [{ name: 'whisper-cli', version: '1.9.5', arch: 'arm64', bundled: true, source: { format: 'build', url: 'https://github.com/ggml-org/whisper.cpp/archive/refs/tags/v1.9.5.tar.gz' }, checksum: null, allowedHosts: ['github.com', 'codeload.github.com'], sha256: null, archiveSha256: null, sourceSha256, updatable: false, license: 'MIT' }] })); return root;
}
describe('reviewed Whisper source build', () => {
  it('fails a null pin before any network or build command', async () => {
    const root = await fixture(null); const fetch = vi.fn<Fetch>(); const run = vi.fn<RunCommand>();
    await expect(buildWhisper({ root, pin: false, arch: 'arm64', fetch, run })).rejects.toThrow('unreviewed'); expect(fetch).not.toHaveBeenCalled(); expect(run).not.toHaveBeenCalled();
  });
  it('rejects a mismatched source hash before extraction', async () => {
    const root = await fixture('a'.repeat(64)); const extract = vi.fn(); const run = vi.fn<RunCommand>(async () => ({ code: 0, stdout: '' }));
    await expect(buildWhisper({ root, pin: false, arch: 'arm64', fetch: async () => new Response('untrusted source archive'), run, extract })).rejects.toThrow('SHA256 mismatch');
    expect(extract).not.toHaveBeenCalled(); expect(run.mock.calls.map((call) => call[0])).toEqual(['cmake', '/usr/bin/xcode-select']);
  });
  it('records --pin without extracting or building in that run', async () => {
    const root = await fixture(null); const extract = vi.fn(); const run = vi.fn<RunCommand>(); const bytes = 'archive bytes';
    await buildWhisper({ root, pin: true, arch: 'arm64', fetch: async () => new Response(bytes), run, extract });
    expect(extract).not.toHaveBeenCalled(); expect(run).not.toHaveBeenCalled();
    const manifest: unknown = JSON.parse(await readFile(path.join(root, 'resources/tools-manifest.json'), 'utf8'));
    expect(manifest).toMatchObject({ tools: [{ sourceSha256: createHash('sha256').update(bytes).digest('hex'), sha256: null }] });
  });
  it.each([
    ['whisper.cpp-1.9.5/../escape\n', '-rw-r--r-- archive path\n'],
    ['/absolute\n', '-rw-r--r-- archive path\n'],
    ['whisper.cpp-1.9.5/link\n', 'lrwxrwxrwx archive path -> outside\n'],
    ['whisper.cpp-1.9.5/link\n', 'hrw-r--r-- archive path link to outside\n'],
  ])('refuses unsafe tar entries before extracting: %s', (names, verbose) => { expect(() => validateTarListing(names, verbose)).toThrow('Unsafe'); });
  it('accepts only regular files/directories under the pinned source root', () => {
    expect(() => validateTarListing('whisper.cpp-1.9.5/\nwhisper.cpp-1.9.5/CMakeLists.txt\n', 'drwxr-xr-x directory\n-rw-r--r-- file\n')).not.toThrow();
  });
});
