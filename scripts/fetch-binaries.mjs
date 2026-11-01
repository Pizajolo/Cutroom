import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, constants } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, mkdtemp, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const run = promisify(execFile);
const clearQuarantine = async (file) => {
  if (process.platform !== 'darwin') return;
  const attributes = await run('/usr/bin/xattr', [file], { timeout: 10_000 });
  if (attributes.stdout.split('\n').includes('com.apple.quarantine')) await run('/usr/bin/xattr', ['-d', 'com.apple.quarantine', file], { timeout: 10_000 });
};
const manifestPath = path.join(root, 'resources/tools-manifest.json');
const pin = process.argv.includes('--pin');
const selectedArch = process.argv.find((arg) => arg.startsWith('--arch='))?.slice(7);
if (selectedArch && !['arm64', 'x64'].includes(selectedArch)) throw new Error('Expected --arch=arm64 or --arch=x64');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.tools)) throw new Error('Invalid tools manifest');
const sha = async (file) => { const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex'); };
const download = async (url, output, limit) => {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'ffmpeg.martin-riedl.de') throw new Error('Unapproved binary source');
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(120_000) });
  if (!response.ok || !response.body) throw new Error(`Binary download failed: HTTP ${response.status} from ${parsed.hostname}`);
  let size = 0;
  await pipeline(Readable.fromWeb(response.body), new Transform({ transform(chunk, _encoding, callback) { size += chunk.length; callback(size > limit ? new Error('Download exceeds size limit') : null, chunk); } }), createWriteStream(output, { flags: 'wx', mode: 0o600 }));
};
const unzip = async (args, output) => {
  const child = spawn('/usr/bin/unzip', args, { shell: false, stdio: ['ignore', 'pipe', 'ignore'] });
  const exit = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code) => code === 0 ? resolve() : reject(new Error('Cannot read binary ZIP archive'))); });
  let size = 0;
  try {
    await Promise.all([pipeline(child.stdout, new Transform({ transform(chunk, _encoding, callback) { size += chunk.length; callback(size > 256 * 1024 * 1024 ? new Error('ZIP entry exceeds size limit') : null, chunk); } }), createWriteStream(output, { flags: 'wx', mode: 0o600 })), exit]);
  } catch (error) { child.kill('SIGKILL'); throw error; }
};
for (const entry of manifest.tools.filter((tool) => tool.bundled !== false && (!selectedArch || tool.arch === selectedArch))) {
  if (!['ffmpeg', 'ffprobe'].includes(entry.name) || !['arm64', 'x64'].includes(entry.arch) || !/^\d+\.\d+\.\d+$/.test(entry.version)) throw new Error('Invalid tool pin');
  const digest = /^[a-f0-9]{64}$/;
  if ((!digest.test(entry.archiveSha256 ?? '') || !digest.test(entry.sha256 ?? '')) && !pin) throw new Error(`${entry.name}/${entry.arch}: unresolved checksums. Use --pin only to obtain and review the upstream release checksums, then commit the resulting manifest before distributing.`);
  const target = path.join(root, 'resources/bin', entry.arch, entry.name);
  if (digest.test(entry.sha256 ?? '') && digest.test(entry.archiveSha256 ?? '')) {
    try {
      const info = await lstat(target);
      if (!info.isFile() || await sha(target) !== entry.sha256) throw new Error(`Refusing to replace a different existing binary: ${target}`);
      await chmod(target, 0o755); await clearQuarantine(target);
      console.log(`${entry.name}/${entry.arch} already verified; no download needed.`);
      continue;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const temporary = await mkdtemp(path.join(tmpdir(), 'cutroom-binary-download-'));
  try {
    const downloadDir = path.join(temporary, 'download'); const extractedDir = path.join(temporary, 'extracted');
    await mkdir(downloadDir); await mkdir(extractedDir);
    if (!entry.archiveSha256) {
      const checksumFile = path.join(downloadDir, 'checksum.txt'); await download(entry.checksumUrl, checksumFile, 4096);
      const match = /^([a-f0-9]{64})(?:[ \t]+\*?[^\r\n]+)?\s*$/i.exec((await readFile(checksumFile, 'utf8')).trim());
      if (!match) throw new Error('Unrecognized SHA256 file format');
      entry.archiveSha256 = match[1].toLowerCase();
    }
    const archive = path.join(downloadDir, 'binary.zip'); await download(entry.sourceUrl, archive, 256 * 1024 * 1024);
    if (await sha(archive) !== entry.archiveSha256) throw new Error('Binary archive checksum mismatch');
    // Never extract paths from an untrusted archive. Read only the exact, expected root entry.
    const binary = path.join(extractedDir, entry.name); await unzip(['-p', archive, entry.name], binary);
    const handle = await open(binary, 'r');
    try {
      const header = Buffer.alloc(8); const result = await handle.read(header, 0, 8, 0);
      if (result.bytesRead !== 8 || header.readUInt32LE(0) !== 0xfeedfacf || header.readUInt32LE(4) !== (entry.arch === 'arm64' ? 0x0100000c : 0x01000007)) throw new Error('Unexpected Mach-O binary architecture');
    } finally { await handle.close(); }
    const actual = await sha(binary);
    if (entry.sha256 && actual !== entry.sha256) throw new Error('Executable checksum mismatch');
    if (!entry.sha256) entry.sha256 = actual;
    await mkdir(path.dirname(target), { recursive: true });
    try {
      const info = await lstat(target);
      if (!info.isFile() || await sha(target) !== entry.sha256) throw new Error(`Refusing to overwrite an existing binary: ${target}`);
      console.log(`${entry.name}/${entry.arch} already matches its checksum.`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await copyFile(binary, target, constants.COPYFILE_EXCL); await chmod(target, 0o755);
      console.log(`Verified ${entry.name}/${entry.arch} ${entry.version}: ${entry.sha256}`);
    }
    await clearQuarantine(target);
    if (pin) {
      const staged = `${manifestPath}.${randomUUID()}.partial`;
      try { await writeFile(staged, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' }); await rename(staged, manifestPath); }
      finally { await rm(staged, { force: true }); }
    }
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
