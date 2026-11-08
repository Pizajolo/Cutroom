import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runCommand, type RunCommand } from '@main/process/run';
import { ToolInstaller } from '@main/tools/installer';
import { ToolRegistry } from '@main/tools/registry';
import { BUILD_ENV, ensureCmake, validateCmakeListing } from '@main/tools/cmake';
import { parseManifest, type BuildToolPin, type ToolPin } from '@main/tools/manifest';
import type { Fetch } from '@main/tools/download';

const roots: string[] = []; const installers: ToolInstaller[] = [];
afterEach(async () => { await Promise.all(installers.splice(0).map((installer) => installer.close())); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const cmakePin: BuildToolPin = { name: 'cmake', version: '4.4.5', arch: 'universal', url: 'https://fixture.test/cmake.tar.gz', checksum: { url: 'https://fixture.test/sums', format: 'sums', entry: 'cmake-4.4.5-macos-universal.tar.gz' }, allowedHosts: ['fixture.test'] };
async function setup() {
  const root = await mkdtemp(path.join(process.env.TMPDIR ?? tmpdir(), 'cutroom-runtime-whisper-')); roots.push(root);
  const source = path.join(root, 'source'); const cmake = path.join(root, 'cmake');
  await mkdir(path.join(source, 'whisper.cpp-1.9.5'), { recursive: true }); await writeFile(path.join(source, 'whisper.cpp-1.9.5/CMakeLists.txt'), 'fixture, never compiled');
  const contents = path.join(cmake, 'cmake-4.4.5-macos-universal/CMake.app/Contents');
  await mkdir(path.join(contents, 'bin'), { recursive: true }); await mkdir(path.join(contents, 'share/cmake-4.4'), { recursive: true });
  await writeFile(path.join(contents, 'bin/cmake'), 'fixture, never executed'); await writeFile(path.join(contents, 'share/cmake-4.4/module'), 'fixture'); await symlink('/unselected-outside', path.join(contents, 'unselected-link'));
  const pack = async (folder: string, entry: string, name: string): Promise<Buffer> => { const archive = path.join(root, name); expect((await runCommand('/usr/bin/tar', ['-czf', archive, '-C', folder, entry])).code).toBe(0); return readFile(archive); };
  const sourceBytes = await pack(source, 'whisper.cpp-1.9.5', 'source.tar.gz'); const cmakeBytes = await pack(cmake, 'cmake-4.4.5-macos-universal', 'cmake.tar.gz');
  const pin: ToolPin = { name: 'whisper-cli', version: '1.9.5', arch: 'arm64', bundled: true, source: { format: 'build', url: 'https://fixture.test/source.tar.gz' }, checksum: null, sourceSha256: hash(sourceBytes), archiveSha256: null, sha256: null, allowedHosts: ['fixture.test'], updatable: false, license: 'MIT' };
  const fetch = vi.fn<Fetch>(async (url) => String(url).endsWith('/sums') ? new Response(`${hash(cmakeBytes)}  ${cmakePin.checksum.entry}\n`) : new Response(new Uint8Array(String(url).endsWith('/cmake.tar.gz') ? cmakeBytes : sourceBytes)));
  const binary = Buffer.alloc(64); binary.writeUInt32LE(0xfeedfacf); binary.writeUInt32LE(0x0100000c, 4);
  const progress: number[] = [];
  let onBuild: ((signal: AbortSignal) => Promise<void>) | undefined;
  const run = vi.fn<RunCommand>(async (executable, args, options) => {
    if (executable === '/usr/bin/tar') return runCommand(executable, args, options);
    if (executable === '/usr/bin/xcode-select' || executable === '/usr/bin/clang') return { code: 0, stdout: '/Library/Developer/CommandLineTools\n' };
    expect(path.isAbsolute(executable)).toBe(true); expect(options?.env).toEqual(BUILD_ENV);
    if (args[0] === '--version') return { code: 0, stdout: 'cmake version 4.4.5\n' };
    expect(options?.signal).toBeDefined(); expect(options?.onStdout).toBeTypeOf('function');
    if (args[0] === '-S') { expect(options?.timeoutMs).toBe(120000); expect(args).toContain('-DWHISPER_SDL2=OFF'); }
    if (args[0] === '--build') {
      expect(options?.timeoutMs).toBe(1200000); expect(args.at(-1)).toMatch(/^-j[1-9]\d*$/u);
      options?.onStdout?.('[ 1'); options?.onStdout?.('2%] building\n[100%] done\n');
      await onBuild?.(options!.signal!); options?.signal?.throwIfAborted();
      await mkdir(path.join(args[1]!, 'bin'), { recursive: true }); await writeFile(path.join(args[1]!, 'bin/whisper-cli'), binary);
    }
    return { code: 0, stdout: '' };
  });
  const home = path.join(root, 'home'); const registry = new ToolRegistry({ home, bundledRoot: path.join(root, 'bundle'), arch: 'arm64', manifest: { schemaVersion: 2, models: [], tools: [pin], buildTools: [cmakePin] }, onChanged: (tools) => { const state = tools[0]?.install; if (state?.state === 'building') progress.push(state.received); } });
  await registry.initialize();
  const installer = new ToolInstaller({ registry, fetch, run, clearQuarantine: async () => {} }); installers.push(installer);
  return { root, home, registry, installer, fetch, run, pin, binary, progress, setOnBuild: (callback: typeof onBuild) => { onBuild = callback; } };
}
it('builds from fixture-pinned source, extracts only selected CMake files, and trusts the built record on relaunch', async () => {
  const env = await setup(); const installs = vi.spyOn(env.registry, 'setInstall'); await env.installer.ensureAll();
  expect(installs).toHaveBeenCalledWith('whisper-cli', { state: 'building', received: 12, total: 100 }); expect(installs).toHaveBeenCalledWith('whisper-cli', { state: 'building', received: 100, total: 100 });
  expect((await env.registry.list())[0]).toMatchObject({ status: 'ok', verification: 'built', install: null, action: null });
  expect(await readFile(await env.registry.resolve('whisper-cli'))).toEqual(env.binary);
  expect((await env.registry.installed.read()).records[0]).toMatchObject({ verification: 'built', archiveSha256: env.pin.sourceSha256, sha256: hash(env.binary) });
  const build = env.run.mock.calls.find((call) => call[1][0] === '--build')!; expect(build[0]).toContain('/tools/.build/cmake/4.4.5/installed/');
  const cache = path.join(env.home, 'tools/.build/cmake/4.4.5/installed/cmake-4.4.5-macos-universal/CMake.app/Contents'); expect(await readdir(cache)).toEqual(['bin', 'share']);
  const next = new ToolRegistry(env.registry.options); await next.initialize(); const installer = new ToolInstaller({ registry: next, fetch: env.fetch, run: env.run }); installers.push(installer);
  const before = env.fetch.mock.calls.length; await installer.ensureAll(); expect(env.fetch).toHaveBeenCalledTimes(before);
  await ensureCmake({ home: env.home, pin: cmakePin, signal: new AbortController().signal, fetch: env.fetch, run: env.run }); expect(env.fetch).toHaveBeenCalledTimes(before);
  const sourceHash = env.pin.sourceSha256; env.pin.sourceSha256 = 'a'.repeat(64); expect((await next.list())[0]?.status).toBe('checksum_mismatch'); env.pin.sourceSha256 = sourceHash;
  await writeFile(path.join(env.home, 'tools/whisper-cli/1.9.5/whisper-cli'), 'user replacement'); await expect(env.installer.install('whisper-cli')).rejects.toThrow(); expect(await readFile(path.join(env.home, 'tools/whisper-cli/1.9.5/whisper-cli'), 'utf8')).toBe('user replacement');
});
it('fails closed before any process or network when the source pin is absent', async () => {
  const env = await setup(); env.pin.sourceSha256 = null; await env.installer.ensureAll();
  expect(env.fetch).not.toHaveBeenCalled(); expect(env.run).not.toHaveBeenCalled();
  expect((await env.registry.list())[0]).toMatchObject({ action: null, install: { state: 'failed', error: expect.stringContaining('source pin missing') } });
});
it('missing developer tools never opens an OS dialog until the explicit action', async () => {
  const env = await setup(); env.run.mockImplementation(async (_binary, args) => ({ code: args[0] === '--install' ? 0 : 1, stdout: '' }));
  await env.installer.ensureAll(); expect(env.fetch).not.toHaveBeenCalled(); expect(env.run.mock.calls.map((call) => call[1])).toEqual([['-p']]);
  expect((await env.registry.list())[0]).toMatchObject({ action: 'install_clt', hint: "Install Apple's Command Line Tools to enable transcription" });
  await expect(env.installer.installPrerequisite('xcode-clt')).resolves.toEqual({ ok: true }); expect(env.run.mock.calls.at(-1)?.slice(0, 2)).toEqual(['/usr/bin/xcode-select', ['--install']]);
});
it('rejects a CMake checksum mismatch before any archive inspection or extraction', async () => {
  const env = await setup(); env.fetch.mockImplementation(async (url) => String(url).endsWith('/sums') ? new Response(`${'a'.repeat(64)}  ${cmakePin.checksum.entry}\n`) : new Response('bad archive'));
  await expect(env.installer.install('whisper-cli')).rejects.toThrow('checksum'); expect(env.run.mock.calls.some((call) => call[0] === '/usr/bin/tar')).toBe(false);
  expect(await readdir(path.join(env.home, 'tools/.build/cmake/4.4.5'))).toEqual([]);
});
it('cancel during compilation removes temporary source and output, and retry can finish', async () => {
  const env = await setup(); let started!: () => void; const ready = new Promise<void>((resolve) => { started = resolve; });
  env.setOnBuild(async (signal) => { started(); await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true })); });
  const job = env.installer.install('whisper-cli'); const rejected = expect(job).rejects.toThrow('cancelled'); await ready; await env.installer.cancel('whisper-cli'); await rejected;
  expect((await readdir(path.join(env.home, 'tools'))).filter((name) => name.startsWith('.staging-'))).toEqual([]); expect((await env.registry.installed.read()).records).toEqual([]);
  env.setOnBuild(undefined); await env.installer.install('whisper-cli'); expect((await env.registry.list())[0]?.verification).toBe('built');
});
it('build-tool pins are separate from editor tools and duplicate pins are rejected', () => {
  const input = { schemaVersion: 2, tools: [], buildTools: [cmakePin] }; expect(parseManifest(input).tools).toEqual([]);
  expect(() => parseManifest({ ...input, buildTools: [cmakePin, cmakePin] })).toThrow('Duplicate'); expect(() => parseManifest({ ...input, buildTools: [{ ...cmakePin, url: 'http://fixture.test/archive' }] })).toThrow();
});
it('rejects selected archive symlinks and traversal independently', () => {
  const binary = 'root/bin/cmake'; const share = 'root/share/cmake-4.4';
  expect(() => validateCmakeListing(`${binary}\n${share}/\n`, '-rwx regular\ndrwx directory\n', binary, share)).not.toThrow();
  expect(() => validateCmakeListing(`${binary}\n${share}/\n`, 'lrwx link\ndrwx directory\n', binary, share)).toThrow('Unsafe');
  expect(() => validateCmakeListing(`${binary}\n${share}/../../escape\n`, '-rwx regular\n-rwx regular\n', binary, share)).toThrow('Unsafe');
});
