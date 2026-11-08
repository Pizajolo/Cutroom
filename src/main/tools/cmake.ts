import { chmod, lstat, mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { z } from 'zod/v3';
import { runCommand, type RunCommand } from '../process/run';
import { managedPath, readManaged } from '../fs/managed';
import { atomicJson, isMissing, managedDirectory, sha256 } from './files';
import { checksumFromText, download, DownloadFailure, type Fetch } from './download';
import type { BuildToolPin } from './manifest';

export const BUILD_ENV = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: homedir() };
export const CLT_MESSAGE = "Install Apple's Command Line Tools to enable transcription";
export async function hasDeveloperTools(run: RunCommand = runCommand, signal?: AbortSignal): Promise<boolean> {
  try {
    const options = { env: BUILD_ENV, ...(signal ? { signal } : {}), timeoutMs: 15000 };
    return (await run('/usr/bin/xcode-select', ['-p'], options)).code === 0 && (await run('/usr/bin/clang', ['--version'], options)).code === 0;
  } catch { return false; }
}
export function validateCmakeListing(names: string, verbose: string, binary: string, share: string): void {
  const paths = names.trimEnd().split('\n'); const rows = verbose.trimEnd().split('\n');
  if (!paths.length || paths.length !== rows.length || !paths.includes(binary) || !paths.some((name) => name === share || name.startsWith(`${share}/`)) || paths.some((name) => (name !== binary && name !== share && !name.startsWith(`${share}/`)) || [...name].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || name.split('/').some((part) => part === '..' || part === '.')) || rows.some((row) => !['-', 'd'].includes(row[0] ?? ''))) throw new DownloadFailure('Unsafe CMake archive. Nothing was extracted.');
}
const receiptSchema = z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/), archiveSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export async function ensureCmake(options: { home: string; pin: BuildToolPin; signal: AbortSignal; run?: RunCommand; fetch?: Fetch }): Promise<string> {
  const { pin, signal } = options; const run = options.run ?? runCommand;
  signal.throwIfAborted();
  const root = `cmake-${pin.version}-macos-universal`;
  const binary = `${root}/CMake.app/Contents/bin/cmake`; const share = `${root}/CMake.app/Contents/share/cmake-${pin.version.split('.').slice(0, 2).join('.')}`;
  const base = await managedDirectory(options.home, 'tools', '.build', 'cmake', pin.version); const installed = path.join(base, 'installed');
  const verify = async (folder: string): Promise<string> => {
    const executable = await managedPath(folder, binary);
    const version = await run(executable, ['--version'], { signal, env: BUILD_ENV, timeoutMs: 15000 });
    if (version.code !== 0 || !version.stdout.startsWith(`cmake version ${pin.version}\n`)) throw new DownloadFailure('The CMake build tool could not run.');
    return executable;
  };
  let cached = false;
  try { const info = await lstat(installed); if (!info.isDirectory()) throw new DownloadFailure('The cached CMake build tool is invalid.'); cached = true; }
  catch (error) { if (!isMissing(error)) throw error; }
  if (cached) {
    const receipt = receiptSchema.parse(JSON.parse(await readManaged(installed, 'receipt.json', 4096)));
    if (await sha256(await managedPath(installed, binary)) !== receipt.sha256) throw new DownloadFailure('The cached CMake checksum does not match.');
    return verify(installed);
  }
  const staging = await mkdtemp(path.join(base, '.stage-'));
  try {
    const downloads = path.join(staging, 'downloads'); const checksums = path.join(staging, 'checksums'); const extracted = path.join(staging, 'extracted'); await mkdir(downloads); await mkdir(checksums); await mkdir(extracted);
    const sums = path.join(checksums, 'checksums.txt');
    await download({ url: pin.checksum.url, policy: pin, file: sums, limit: 1024 * 1024, signal, fetch: options.fetch });
    const expected = checksumFromText(await readFile(sums, 'utf8'), pin.checksum.format, pin.checksum.entry);
    const archive = path.join(downloads, 'cmake.tar.gz');
    const result = await download({ url: pin.url, policy: pin, file: archive, limit: 256 * 1024 * 1024, signal, fetch: options.fetch });
    if (result.sha256 !== expected) throw new DownloadFailure('The CMake archive checksum does not match. Nothing was extracted.');
    const commandOptions = { signal, env: BUILD_ENV, timeoutMs: 60000, maxOutputBytes: 8 * 1024 * 1024 };
    const names = await run('/usr/bin/tar', ['-tzf', archive, binary, share], commandOptions);
    const verbose = await run('/usr/bin/tar', ['-tvzf', archive, binary, share], commandOptions);
    if (names.code !== 0 || verbose.code !== 0) throw new DownloadFailure('Cannot inspect the CMake build tool archive.');
    validateCmakeListing(names.stdout, verbose.stdout, binary, share);
    if ((await run('/usr/bin/tar', ['-xzf', archive, '-C', extracted, '--no-same-owner', '--no-same-permissions', binary, share], commandOptions)).code !== 0) throw new DownloadFailure('Cannot extract the CMake build tool.');
    const executable = await managedPath(extracted, binary); await chmod(executable, 0o755);
    await verify(extracted);
    await atomicJson(path.join(extracted, 'receipt.json'), { sha256: await sha256(executable), archiveSha256: expected });
    signal.throwIfAborted();
    await rename(extracted, installed); return path.join(installed, binary);
  } finally { await rm(staging, { recursive: true, force: true }); }
}
