import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(path.join(root, 'resources/tools-manifest.json'), 'utf8'));
const run = promisify(execFile);
const native = new Map();
for (const entry of manifest.tools.filter((tool) => tool.bundled !== false && ['ffmpeg', 'ffprobe'].includes(tool.name))) {
  if (!['ffmpeg', 'ffprobe'].includes(entry.name) || !['arm64', 'x64'].includes(entry.arch)) throw new Error('Invalid tool manifest entry');
  if (!/^[a-f0-9]{64}$/.test(entry.sha256 ?? '') || !/^[a-f0-9]{64}$/.test(entry.archiveSha256 ?? '')) throw new Error(`${entry.name}/${entry.arch}: checksums have not been pinned; bundled FFmpeg is not verified.`);
  const file = path.join(root, 'resources/bin', entry.arch, entry.name);
  if (!(await lstat(file)).isFile()) throw new Error('Expected a regular bundled executable');
  const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk);
  if (hash.digest('hex') !== entry.sha256) throw new Error(`${entry.name}/${entry.arch}: checksum mismatch`);
  if (entry.arch === process.arch) native.set(entry.name, { file, version: entry.version });
}
if (process.platform !== 'darwin') throw new Error('Capability verification requires macOS; no bundled executable was run.');
for (const name of ['ffmpeg', 'ffprobe']) {
  const entry = native.get(name); if (!entry) throw new Error(`Missing native ${name}`);
  const { stdout } = await run(entry.file, ['-version'], { timeout: 20_000, maxBuffer: 4 * 1024 * 1024 });
  if (!stdout.includes(`version ${entry.version}`)) throw new Error(`${name} version does not match the manifest`);
  const dependencies = await run('/usr/bin/otool', ['-L', entry.file], { timeout: 20_000 });
  for (const line of dependencies.stdout.split('\n').slice(1).map((value) => value.trim()).filter(Boolean)) {
    if (!line.startsWith('/usr/lib/') && !line.startsWith('/System/Library/')) throw new Error(`${name} depends on a non-system library: ${line}`);
  }
}
const ffmpeg = native.get('ffmpeg').file;
const inspect = async (flag) => { const result = await run(ffmpeg, ['-hide_banner', flag], { timeout: 20_000, maxBuffer: 4 * 1024 * 1024 }); return result.stdout + result.stderr; };
const encoders = await inspect('-encoders'); const filters = await inspect('-filters'); const configuration = await inspect('-buildconf');
const hasEncoder = (name) => encoders.split('\n').some((line) => line.trim().split(/\s+/)[1] === name);
for (const encoder of ['libx264', 'libx265', 'libvpx-vp9', 'libopus', 'libmp3lame', 'aac', 'prores_ks', 'png']) if (!hasEncoder(encoder)) throw new Error(`Missing encoder: ${encoder}`);
if (!hasEncoder('libaom-av1') && !hasEncoder('libsvtav1')) throw new Error('Missing AV1 encoder (libaom-av1 or libsvtav1)');
for (const filter of ['loudnorm', 'ebur128', 'silencedetect', 'blackdetect', 'freezedetect', 'scdet', 'zscale', 'subtitles', 'drawtext', 'alphamerge', 'sidechaincompress', 'lut3d', 'tile']) if (!filters.split('\n').some((line) => line.trim().split(/\s+/)[1] === filter)) throw new Error(`Missing filter: ${filter}`);
if (!configuration.includes('--enable-gpl') || configuration.includes('--enable-nonfree')) throw new Error('Unexpected FFmpeg license configuration');
console.log('Both architectures match SHA256 pins; native FFmpeg/ffprobe versions, system-only linkage, encoders and filters passed. Distribution source/license compliance must be reviewed separately.');
