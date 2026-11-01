import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { runCommand } from '../process/run';

export function hasMachArchitecture(header: Buffer, arch: string): boolean {
  if (header.length < 8 || !['arm64', 'x64'].includes(arch)) return false;
  const cpu = arch === 'arm64' ? 0x0100000c : 0x01000007;
  if (header.readUInt32LE(0) === 0xfeedfacf) return header.readUInt32LE(4) === cpu;
  if (header.readUInt32BE(0) === 0xfeedfacf) return header.readUInt32BE(4) === cpu;
  const magic = header.readUInt32BE(0);
  if (![0xcafebabe, 0xcafebabf, 0xbebafeca, 0xbfbafeca].includes(magic)) return false;
  const little = magic === 0xbebafeca || magic === 0xbfbafeca;
  const read = (offset: number): number => little ? header.readUInt32LE(offset) : header.readUInt32BE(offset);
  const count = read(4); const stride = magic === 0xcafebabf || magic === 0xbfbafeca ? 32 : 20;
  if (count < 1 || count > 64 || header.length < 8 + count * stride) return false;
  for (let i = 0; i < count; i++) if (read(8 + i * stride) === cpu) return true;
  return false;
}
export async function verifyArchitecture(file: string, arch: string): Promise<void> {
  const handle = await open(file, 'r');
  try { const buffer = Buffer.alloc(4096); const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0); if (!hasMachArchitecture(buffer.subarray(0, bytesRead), arch)) throw new Error('The downloaded executable does not support this Mac architecture.'); }
  finally { await handle.close(); }
}
export async function extractZip(archive: string, entry: string, output: string, signal: AbortSignal): Promise<void> {
  const listing = await runCommand('/usr/bin/unzip', ['-Z1', archive], { signal });
  if (listing.code !== 0 || listing.stdout.split(/\r?\n/).filter((line) => line === entry).length !== 1) throw new Error('The archive does not contain exactly one expected executable.');
  const combined = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
  const child = spawn('/usr/bin/unzip', ['-p', archive, entry], { shell: false, signal: combined, killSignal: 'SIGKILL', stdio: ['ignore', 'pipe', 'ignore'] });
  const exit = new Promise<void>((resolve, reject) => { child.once('error', () => reject(new Error('Cannot extract the downloaded archive.'))); child.once('close', (code) => code === 0 ? resolve() : reject(new Error('Cannot extract the downloaded archive.'))); });
  let size = 0;
  try {
    await Promise.all([pipeline(child.stdout, new Transform({ transform(chunk: Buffer, _encoding, callback) { size += chunk.length; callback(size > 512 * 1024 * 1024 ? new Error('Extracted executable exceeds the size limit.') : null, chunk); } }), createWriteStream(output, { flags: 'wx', mode: 0o600 }), { signal: combined }), exit]);
  } catch { child.kill('SIGKILL'); await exit.catch(() => undefined); throw new Error('Cannot extract the downloaded archive.'); }
}
export async function clearQuarantine(file: string, signal: AbortSignal): Promise<void> {
  if (process.platform !== 'darwin') return;
  const result = await runCommand('/usr/bin/xattr', [file], { signal });
  if (result.code !== 0) throw new Error('Could not inspect downloaded executable attributes.');
  if (result.stdout.split('\n').includes('com.apple.quarantine')) {
    if ((await runCommand('/usr/bin/xattr', ['-d', 'com.apple.quarantine', file], { signal })).code !== 0) throw new Error('Could not clear downloaded executable quarantine.');
  }
}
