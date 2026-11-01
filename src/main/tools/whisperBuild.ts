import { chmod, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseManifest } from './manifest';
import { download, type Fetch } from './download';
import { atomicJson, managedDirectory, publishExclusive, sha256 } from './files';
import { verifyArchitecture } from './binary';
import { runCommand, type RunCommand } from '../process/run';

export function validateTarListing(names: string, verbose: string): void {
  const paths = names.trimEnd().split('\n'); const rows = verbose.trimEnd().split('\n');
  if (!paths.length || paths.length !== rows.length || paths.some((name) => !name.startsWith('whisper.cpp-1.9.5/') || [...name].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || name.split('/').some((part) => part === '..' || part === '.')) || rows.some((row) => !['-', 'd'].includes(row[0] ?? ''))) throw new Error('Unsafe source archive: links, absolute paths or traversal are not permitted.');
}
export async function buildWhisper(options: { root: string; pin: boolean; arch?: string; fetch?: Fetch; run?: RunCommand; extract?: (archive: string, target: string) => Promise<void>; log?: (message: string) => void }): Promise<void> {
  const arch = options.arch ?? process.arch; if (!['arm64', 'x64'].includes(arch)) throw new Error('whisper-cli is supported on macOS arm64 and x64 only.');
  const manifestFile = path.join(options.root, 'resources/tools-manifest.json');
  const manifest = parseManifest(JSON.parse(await readFile(manifestFile, 'utf8')));
  const pin = manifest.tools.find((pin) => pin.name === 'whisper-cli' && pin.arch === arch && pin.source.format === 'build');
  if (!pin?.source.url) throw new Error('Missing whisper-cli source manifest entry.');
  if (!options.pin && !/^[a-f0-9]{64}$/.test(pin.sourceSha256 ?? '')) throw new Error('The whisper.cpp v1.9.5 source pin is unreviewed. Run npm run build:whisper -- --pin, review the hash, and commit it before building. No download or build was attempted.');
  const run = options.run ?? runCommand;
  if (!options.pin) {
    try { if ((await run('cmake', ['--version'])).code !== 0) throw new Error(); } catch { throw new Error('cmake is required. Install cmake, then run npm run build:whisper again.'); }
    try { if ((await run('/usr/bin/xcode-select', ['-p'])).code !== 0) throw new Error(); } catch { throw new Error('Xcode Command Line Tools are required. Run xcode-select --install, then retry.'); }
  }
  const temp = await mkdtemp(path.join(tmpdir(), 'cutroom-whisper-build-'));
  try {
    const downloads = path.join(temp, 'downloads'); const extracted = path.join(temp, 'extracted'); const build = path.join(temp, 'build');
    await mkdir(downloads); await mkdir(extracted);
    const archive = path.join(downloads, 'source.tar.gz');
    const result = await download({ url: pin.source.url, file: archive, policy: pin, limit: 128 * 1024 * 1024, signal: AbortSignal.timeout(600_000), fetch: options.fetch });
    if (options.pin) {
      for (const entry of manifest.tools.filter((entry) => entry.name === 'whisper-cli' && entry.version === pin.version)) entry.sourceSha256 = result.sha256;
      await atomicJson(manifestFile, manifest);
      options.log?.(`whisper.cpp v${pin.version} source SHA256: ${result.sha256}\n${pin.source.url}\nRecorded only. Review and commit the pin; no extraction or build was performed.`); return;
    }
    if (result.sha256 !== pin.sourceSha256) throw new Error('Whisper source SHA256 mismatch. Nothing was extracted or built.');
    if (options.extract) await options.extract(archive, extracted);
    else {
      const names = await run('/usr/bin/tar', ['-tzf', archive]); const verbose = await run('/usr/bin/tar', ['-tvzf', archive]);
      if (names.code !== 0 || verbose.code !== 0) throw new Error('Cannot inspect Whisper source archive.');
      validateTarListing(names.stdout, verbose.stdout);
      if ((await run('/usr/bin/tar', ['-xzf', archive, '-C', extracted, '--no-same-owner', '--no-same-permissions'])).code !== 0) throw new Error('Cannot extract verified Whisper source.');
    }
    const source = path.join(extracted, 'whisper.cpp-1.9.5');
    const configured = await run('cmake', ['-S', source, '-B', build, '-DCMAKE_BUILD_TYPE=Release', '-DGGML_METAL=ON', '-DGGML_METAL_EMBED_LIBRARY=ON', '-DBUILD_SHARED_LIBS=OFF', '-DWHISPER_BUILD_TESTS=OFF'], { timeoutMs: 120_000 });
    if (configured.code !== 0 || (await run('cmake', ['--build', build, '--config', 'Release', '--target', 'whisper-cli', '-j2'], { timeoutMs: 1_200_000 })).code !== 0) throw new Error('Whisper compilation failed. Check cmake and Xcode Command Line Tools.');
    const binary = path.join(build, 'bin/whisper-cli'); await verifyArchitecture(binary, arch); const hash = await sha256(binary);
    const target = await managedDirectory(options.root, 'resources', 'bin', arch); await chmod(binary, 0o755);
    await publishExclusive(binary, path.join(target, 'whisper-cli'), hash); pin.sha256 = hash;
    await atomicJson(manifestFile, manifest); options.log?.(`Built whisper-cli v${pin.version} for ${arch}: ${hash}`);
  } finally { await rm(temp, { recursive: true, force: true }); }
}
