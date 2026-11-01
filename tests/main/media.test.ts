import { afterEach, describe, expect, it, vi } from 'vitest';
import * as mediaProcesses from '../../src/main/media/process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { importName, importPaths } from '../../src/main/media/import';
import { parseFrameRate, parseProbe, probe, probeArgs } from '../../src/main/media/probe';
import { thumbnailArgs, thumbnailLayout, thumbnails } from '../../src/main/media/thumbnails';
import { PeakAccumulator, waveform, waveformArgs } from '../../src/main/media/waveform';
import { runTool, stopMediaProcesses, type ToolResolver } from '../../src/main/media/process';
import type { MediaContext } from '../../src/main/media/cache';
import { MediaService } from '../../src/main/media/service';
import type { MediaProbe } from '../../src/shared/schema/media';

const temporary: string[] = [];
afterEach(async () => { await stopMediaProcesses(); await Promise.all(temporary.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function folder(): Promise<string> { const root = await mkdtemp(path.join(tmpdir(), 'cutroom-media-test-')); temporary.push(root); return root; }
const metadata: MediaProbe = { duration: 12, width: 1920, height: 1080, fps: 30, vcodec: 'h264', acodec: 'aac', channels: 2, sampleRate: 48000, bitrate: 100000, size: 1000, hasAlpha: false };
describe('media pure logic', () => {
  it('parses ffprobe numbers, rational frame rates, missing values and alpha', () => {
    expect(parseFrameRate('30000/1001')).toBeCloseTo(29.97003); expect(parseFrameRate('0/0')).toBeNull(); expect(parseFrameRate('1/0')).toBeNull();
    const result = parseProbe({ format: { duration: '2.5', bit_rate: '9000' }, streams: [{ codec_type: 'video', codec_name: 'prores', width: 1920, height: 1080, avg_frame_rate: '25/1', pix_fmt: 'yuva444p10le' }, { codec_type: 'audio', codec_name: 'pcm_s16le', sample_rate: '48000', channels: 2 }] }, 99);
    expect(result).toMatchObject({ duration: 2.5, fps: 25, width: 1920, height: 1080, hasAlpha: true, size: 99, sampleRate: 48000 });
    expect(() => parseProbe({ streams: [] }, 0)).toThrow();
  });
  it('bounds sprites to 100 frames with 160-pixel tiles, and preserves file arguments', () => {
    const layout = thumbnailLayout(metadata); expect(layout).toMatchObject({ frameHeight: 160, frameWidth: 284, count: 3, columns: 3, rows: 1 });
    expect(layout.frames[2]).toEqual({ time: 10, x: 568, y: 0, w: 284, h: 160 });
    expect(thumbnailLayout({ ...metadata, duration: 3600 }).count).toBe(100);
    const source = '/project/raw/a ; $(do-not-run).mp4'; const args = thumbnailArgs(source, '/cache/sprite.jpg', metadata);
    expect(args[args.indexOf('-i') + 1]).toBe(source); expect(args).toContain('-n'); expect(args).not.toContain('-y');
    expect(probeArgs(source)).toContain(source); expect(waveformArgs(source)).toContain('file,pipe');
    expect(probeArgs(source)).toContain('-format_whitelist');
  });
  it('computes signed min/max over 256 samples, odd byte chunks and final partial buckets', () => {
    const pcm = Buffer.alloc(258 * 2); pcm.writeInt16LE(-32768, 0); pcm.writeInt16LE(32767, 2); pcm.writeInt16LE(-16384, 512); pcm.writeInt16LE(16384, 514);
    const accumulator = new PeakAccumulator(); accumulator.add(pcm.subarray(0, 1)); accumulator.add(pcm.subarray(1, 103)); accumulator.add(pcm.subarray(103));
    expect(accumulator.finish()).toEqual([{ min: -1, max: 32767 / 32768 }, { min: -0.5, max: 0.5 }]); expect(accumulator.samples).toBe(258);
    const truncated = new PeakAccumulator(); truncated.add(Buffer.from([0])); expect(() => truncated.finish()).toThrow('Truncated');
  });
});
describe('explicit source-preserving imports', () => {
  it('copies bytes to unique names, without replacing original or existing media', async () => {
    const root = await folder(); const project = path.join(root, 'project'); await mkdir(project);
    const source = path.join(root, 'clip.mp4'); await writeFile(source, 'original');
    expect(await importPaths(project, [source], 'raw')).toEqual(['raw/clip.mp4']);
    expect(await importPaths(project, [source], 'raw')).toEqual(['raw/clip-1.mp4']);
    expect(await readFile(source, 'utf8')).toBe('original'); expect(await readFile(path.join(project, 'raw/clip.mp4'), 'utf8')).toBe('original');
    expect(importName('/source/a%20b.mp4')).toBe('a_20b.mp4');
  });
  it('preflights the entire batch before project mutation and rejects source symlinks', async () => {
    const root = await folder(); const project = path.join(root, 'project'); await mkdir(project); const source = path.join(root, 'source'); await writeFile(source, 'unchanged');
    await expect(importPaths(project, [source, path.join(root, 'missing')], 'raw')).rejects.toThrow();
    expect(await readdir(project)).toEqual([]); expect(await readFile(source, 'utf8')).toBe('unchanged');
    const alias = path.join(root, 'alias'); await symlink(source, alias);
    await expect(importPaths(project, [alias], 'raw')).rejects.toThrow(); expect(await readdir(project)).toEqual([]);
  });
  it('refuses symlink destinations, including aliases into another source folder', async () => {
    const root = await folder(); const project = path.join(root, 'project'); await mkdir(project); await mkdir(path.join(project, 'references')); await symlink('references', path.join(project, 'raw'));
    const source = path.join(root, 'clip'); await writeFile(source, 'original');
    await expect(importPaths(project, [source], 'raw')).rejects.toMatchObject({ code: 'forbidden' });
    expect(await readdir(path.join(project, 'references'))).toEqual([]);
  });
  it('cancels and removes only partial files exclusively created by this import', async () => {
    const root = await folder(); const project = path.join(root, 'project'); await mkdir(project); await mkdir(path.join(project, 'raw')); await writeFile(path.join(project, 'raw/existing'), 'keep');
    const source = path.join(root, 'large'); await writeFile(source, Buffer.alloc(3 * 1024 * 1024, 7));
    const controller = new AbortController();
    await expect(importPaths(project, [source], 'raw', { signal: controller.signal, onProgress: () => controller.abort() })).rejects.toMatchObject({ details: { kind: 'cancelled' } });
    expect(await readdir(path.join(project, 'raw'))).toEqual(['existing']); expect((await readFile(source)).length).toBe(3 * 1024 * 1024);
  });
});
describe('bounded child-process lifecycle', () => {
  it('cancels an actual child process, without a shell', async () => {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 50);
    try { await expect(runTool(async () => process.execPath, 'ffmpeg', ['-e', 'setInterval(() => {}, 1000)'], { signal: controller.signal })).rejects.toMatchObject({ details: { kind: 'cancelled' } }); }
    finally { clearTimeout(timer); }
  });
  it('rejects excessive output and a child failure with safe typed messages', async () => {
    await expect(runTool(async () => process.execPath, 'ffprobe', ['-e', 'process.stdout.write("x".repeat(8192))'], { maxOutputBytes: 32 })).rejects.toMatchObject({ details: { kind: 'output_limit' } });
    await expect(runTool(async () => process.execPath, 'ffprobe', ['-e', 'process.stderr.write("private/path/secret");process.exit(1)'])).rejects.toMatchObject({ code: 'invalid_request', message: 'ffprobe could not process this media file.' });
  });
});
function findTool(name: string): string | undefined {
  const supplied = name === 'ffmpeg' ? process.env.CUTROOM_TEST_FFMPEG : process.env.CUTROOM_TEST_FFPROBE;
  if (supplied && existsSync(supplied)) return supplied;
  return (process.env.PATH ?? '').split(path.delimiter).filter(Boolean).map((entry) => path.resolve(entry, name)).find((file) => existsSync(file));
}
const ffmpeg = findTool('ffmpeg'); const ffprobe = findTool('ffprobe');
// Test-only injection may use development tools; the application never resolves from PATH.
describe.skipIf(!ffmpeg || !ffprobe)('real media integration (ffmpeg not available when skipped)', () => {
  it('probes, generates a sprite and caches 8kHz/256-sample peaks without changing raw bytes', async () => {
    const root = await realpath(await folder()); await mkdir(path.join(root, 'raw'));
    const source = path.join(root, 'raw/fixture.mp4');
    const generated = spawnSync(ffmpeg!, ['-v', 'error', '-nostdin', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-n', source], { encoding: 'utf8', timeout: 30_000 });
    expect(generated.error).toBeUndefined(); expect(generated.status, generated.stderr).toBe(0);
    const hash = async (): Promise<string> => createHash('sha256').update(await readFile(source)).digest('hex'); const before = await hash();
    const originalMtime = (await stat(source)).mtimeMs;
    const resolver: ToolResolver = async (name) => name === 'ffmpeg' ? ffmpeg! : ffprobe!;
    const context: MediaContext = { root, resolveTool: resolver, url: (rel) => `http://127.0.0.1:12345/k/test/p/test/${rel}` };
    expect(await probe(context, 'raw/fixture.mp4')).toMatchObject({ duration: 2, width: 320, height: 180, fps: 30, channels: 1 });
    const sprite = await thumbnails(context, 'raw/fixture.mp4'); expect(sprite).toMatchObject({ frameHeight: 160, frameWidth: 284, count: 1 });
    const imageMetadata = await probe(context, sprite.imageRel); expect(imageMetadata).toMatchObject({ width: 284, height: 160 });
    const peaks = await waveform(context, 'raw/fixture.mp4'); expect(peaks).toMatchObject({ sampleRate: 8000, samplesPerPeak: 256, duration: 2 }); expect(peaks.peaks).toHaveLength(63);
    const runner = vi.spyOn(mediaProcesses, 'runTool');
    try {
      expect(await waveform(context, 'raw/fixture.mp4')).toEqual(peaks);
      expect(await thumbnails(context, 'raw/fixture.mp4')).toEqual(sprite);
      expect(runner).not.toHaveBeenCalled();
    } finally { runner.mockRestore(); }
    await mkdir(path.join(root, 'final')); await copyFile(source, path.join(root, 'final/result-v1.mp4'));
    const media = new MediaService({ resolveTool: resolver, url: (_id, rel) => context.url(rel) });
    try {
      await expect(media.list()).rejects.toMatchObject({ code: 'not_found' });
      await media.selectFolder(root);
      const files = await media.list(); expect(files.map((file) => file.rel)).toEqual(['final/result-v1.mp4', 'raw/fixture.mp4']);
      for (const file of files) expect(file.probe).toMatchObject({ duration: 2, width: 320, height: 180, fps: 30, vcodec: 'h264', acodec: 'aac' });
    } finally { media.close(); }
    expect(await hash()).toBe(before); expect((await stat(source)).mtimeMs).toBe(originalMtime);
  }, 60_000);
});
