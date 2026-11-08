import { chmod, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { availableParallelism, homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { parseManifest, type ToolPin } from './manifest';
import { download, DownloadFailure, type Fetch } from './download';
import { atomicJson, managedDirectory, publishExclusive, sha256 } from './files';
import { verifyArchitecture } from './binary';
import { runCommand, type RunCommand } from '../process/run';
import { BUILD_ENV, CLT_MESSAGE, ensureCmake, hasDeveloperTools } from './cmake';

export const SOURCE_PIN_MESSAGE = 'Transcription engine not yet available in this build (source pin missing)';
export function validateTarListing(names: string, verbose: string): void {
  const paths = names.trimEnd().split('\n'); const rows = verbose.trimEnd().split('\n');
  if (!paths.length || paths.length !== rows.length || paths.some((name) => !name.startsWith('whisper.cpp-1.9.5/') || [...name].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || name.split('/').some((part) => part === '..' || part === '.')) || rows.some((row) => !['-', 'd'].includes(row[0] ?? ''))) throw new DownloadFailure('Unsafe source archive: links, absolute paths or traversal are not permitted.');
}
export function sourceIsPinned(pin: ToolPin): boolean { return /^[a-f0-9]{64}$/.test(pin.sourceSha256 ?? ''); }
export async function compileWhisper(options: { pin: ToolPin; signal: AbortSignal; run?: RunCommand; fetch?: Fetch; cmakePath: string; workDir: string; onProgress?: (progress: number) => void; extract?: (archive: string, target: string) => Promise<void> }): Promise<string> {
  const { pin, signal, cmakePath, workDir } = options; const run = options.run ?? runCommand;
  if (!sourceIsPinned(pin)) throw new DownloadFailure(SOURCE_PIN_MESSAGE);
  if (!pin.source.url || !path.isAbsolute(cmakePath) || !path.isAbsolute(workDir)) throw new DownloadFailure('Invalid transcription build configuration.');
  signal.throwIfAborted();
  const downloads = path.join(workDir, 'downloads'); const extracted = path.join(workDir, 'extracted'); const build = path.join(workDir, 'build');
  await mkdir(downloads); await mkdir(extracted);
  const archive = path.join(downloads, 'source.tar.gz');
  const result = await download({ url: pin.source.url, file: archive, policy: pin, limit: 128 * 1024 * 1024, signal, fetch: options.fetch });
  if (result.sha256 !== pin.sourceSha256) throw new DownloadFailure('Whisper source SHA256 mismatch. Nothing was extracted or built.');
  const commandOptions = { signal, env: BUILD_ENV, timeoutMs: 60000, maxOutputBytes: 8 * 1024 * 1024 };
  if (options.extract) await options.extract(archive, extracted);
  else {
    const names = await run('/usr/bin/tar', ['-tzf', archive], commandOptions); const verbose = await run('/usr/bin/tar', ['-tvzf', archive], commandOptions);
    if (names.code !== 0 || verbose.code !== 0) throw new DownloadFailure('Cannot inspect Whisper source archive.');
    validateTarListing(names.stdout, verbose.stdout);
    if ((await run('/usr/bin/tar', ['-xzf', archive, '-C', extracted, '--no-same-owner', '--no-same-permissions'], commandOptions)).code !== 0) throw new DownloadFailure('Cannot extract verified Whisper source.');
  }
  const source = path.join(extracted, `whisper.cpp-${pin.version}`);
  options.onProgress?.(0);
  const configured = await run(cmakePath, ['-S', source, '-B', build, '-DCMAKE_BUILD_TYPE=Release', '-DGGML_METAL=ON', '-DGGML_METAL_EMBED_LIBRARY=ON', '-DBUILD_SHARED_LIBS=OFF', '-DWHISPER_BUILD_TESTS=OFF', '-DWHISPER_SDL2=OFF'], { signal, env: BUILD_ENV, timeoutMs: 120000, onStdout: () => undefined });
  if (configured.code !== 0) throw new DownloadFailure('Could not configure the transcription engine. Check Apple Command Line Tools and retry.');
  let pending = '';
  const compiled = await run(cmakePath, ['--build', build, '--config', 'Release', '--target', 'whisper-cli', `-j${availableParallelism()}`], { signal, env: BUILD_ENV, timeoutMs: 1200000, onStdout: (chunk) => {
    pending += chunk;
    let end = 0;
    for (const match of pending.matchAll(/\[\s*(\d{1,3})%\]/gu)) { options.onProgress?.(Math.min(100, Number(match[1]))); end = match.index + match[0].length; }
    pending = pending.slice(end).slice(-64);
  } });
  if (compiled.code !== 0) throw new DownloadFailure('Could not build the transcription engine. Check Apple Command Line Tools and retry.');
  signal.throwIfAborted(); return path.join(build, 'bin/whisper-cli');
}
export async function buildWhisper(options: { root: string; pin: boolean; arch?: string; fetch?: Fetch; run?: RunCommand; extract?: (archive: string, target: string) => Promise<void>; log?: (message: string) => void }): Promise<void> {
  const arch = options.arch ?? process.arch; if (!['arm64', 'x64'].includes(arch)) throw new Error('whisper-cli is supported on macOS arm64 and x64 only.');
  const manifestFile = path.join(options.root, 'resources/tools-manifest.json');
  const manifest = parseManifest(JSON.parse(await readFile(manifestFile, 'utf8')));
  const pin = manifest.tools.find((pin) => pin.name === 'whisper-cli' && pin.arch === arch && pin.source.format === 'build');
  if (!pin?.source.url) throw new Error('Missing whisper-cli source manifest entry.');
  if (!options.pin && !sourceIsPinned(pin)) throw new Error('The whisper.cpp source pin is unreviewed. Run npm run build:whisper -- --pin and review the hash before building. No download or build was attempted.');
  const signal = AbortSignal.timeout(1800000); const run = options.run ?? runCommand;
  const temp = await mkdtemp(path.join(tmpdir(), 'cutroom-whisper-build-'));
  try {
    if (options.pin) {
      const firstDir = path.join(temp, 'first'); const secondDir = path.join(temp, 'second'); await mkdir(firstDir); await mkdir(secondDir);
      const first = await download({ url: pin.source.url, file: path.join(firstDir, 'source.tar.gz'), policy: pin, limit: 128 * 1024 * 1024, signal, fetch: options.fetch });
      const second = await download({ url: pin.source.url, file: path.join(secondDir, 'source.tar.gz'), policy: pin, limit: 128 * 1024 * 1024, signal, fetch: options.fetch });
      if (first.sha256 !== second.sha256) throw new Error('Independent source downloads did not match. No pin was recorded.');
      for (const entry of manifest.tools.filter((entry) => entry.name === 'whisper-cli' && entry.version === pin.version)) entry.sourceSha256 = first.sha256;
      await atomicJson(manifestFile, manifest);
      options.log?.(`whisper.cpp v${pin.version} source SHA256: ${first.sha256}\nSecond download SHA256: ${second.sha256}\n${pin.source.url}\nRecorded only. Review the pin; no extraction or build was performed.`); return;
    }
    if (!await hasDeveloperTools(run, signal)) throw new DownloadFailure(CLT_MESSAGE);
    const cmake = manifest.buildTools?.find((tool) => tool.name === 'cmake');
    if (!cmake) throw new DownloadFailure('The CMake build tool is not configured.');
    const cmakePath = await ensureCmake({ home: path.join(homedir(), '.cutroom'), pin: cmake, signal, run, fetch: options.fetch });
    const binary = await compileWhisper({ pin, signal, run, fetch: options.fetch, cmakePath, workDir: temp, extract: options.extract });
    await verifyArchitecture(binary, arch); const hash = await sha256(binary);
    const target = await managedDirectory(options.root, 'resources', 'bin', arch); await chmod(binary, 0o755);
    await publishExclusive(binary, path.join(target, 'whisper-cli'), hash); pin.sha256 = hash;
    await atomicJson(manifestFile, manifest); options.log?.(`Built whisper-cli v${pin.version} for ${arch}: ${hash}`);
  } finally { await rm(temp, { recursive: true, force: true }); }
}
