import { afterEach, describe, expect, it } from 'vitest';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { compileRender, atempo, ProgressParser } from '@main/render/compiler';
import { BUILTIN_PRESETS } from '@main/render/presets';
import { claimVersion } from '@main/render/service';
import { emptyTimeline } from '@main/projects/service';
import { JobQueue } from '@main/jobs/queue';
import { runCommand } from '@main/process/run';
import type { ProjectSession } from '@shared/schema/project';
import type { TimelineItem } from '@shared/schema/timeline';

const roots: string[] = [];
async function temporary() { const root = await mkdtemp(path.join(process.env.TMPDIR ?? tmpdir(), 'cutroom-export-test-')); roots.push(root); return root; }
const format = { aspect: '16:9', width: 320, height: 180, fps: 30 } as const;
const preset = { ...BUILTIN_PRESETS.find((preset) => preset.id === 'final')!, size: 'project' as const };
const clip: TimelineItem = { id: 'clip_abcdefghij', type: 'clip', src: 'raw/clip.mp4', start: 0, duration: 1, in: 0, out: 2, speed: 2, volume: 1, muted: false, createdBy: 'user', userEdited: [] };
function doc() { const doc = emptyTimeline(format); doc.tracks[3]!.items.push(structuredClone(clip)); return doc; }
function project(rootPath: string): ProjectSession { return { rootPath, looseMediaCount: 0, project: { id: 'project', name: 'Test', defaultEngine: 'hyperframes', format, createdAt: new Date().toISOString(), folderMap: { raw: 'raw', references: 'references', assets: 'assets', compositions: 'compositions', audio: 'audio', work: 'work', final: 'final' } } }; }
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe('pure FFmpeg export compiler', () => {
  it('builds bounded inputs, speed, black gaps, crop/reframe, audio mix and frame output', () => {
    const original = doc(); const item = original.tracks[3]!.items[0]!; if (item.type !== 'clip') throw new Error('Expected clip'); item.crop = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }; item.reframe = { mode: 'fill', x: 0.5, y: 0.4, scale: 1.2 };
    const plan = compileRender(original, preset, { 'raw/clip.mp4': { path: '/project/raw/clip.mp4', hasAudio: true } }, '/project/final/export.mp4');
    expect(plan.args).toContain('-n'); expect(plan.args).not.toContain('-y'); expect(plan.filterGraph).toContain('color=c=black:s=320x180'); expect(plan.filterGraph).toContain('trim=start=0:end=2,setpts=(PTS-STARTPTS)/2'); expect(plan.filterGraph).toContain('crop='); expect(plan.filterGraph).toContain('max(320/iw,180/ih)'); expect(plan.filterGraph).toContain('atempo=2'); expect(plan.filterGraph).toContain('loudnorm=I=-14:TP=-1');
    expect(plan.duration).toBe(1); expect(original.tracks[3]!.items[0]).toEqual(item);
  });
  it('chains extreme tempo values into supported ranges and parses split progress lines monotonically', () => {
    expect(atempo(0.125)).toEqual(['atempo=0.5', 'atempo=0.5', 'atempo=0.5']); expect(atempo(8)).toEqual(['atempo=2', 'atempo=2', 'atempo=2']);
    const seen: number[] = []; const parser = new ProgressParser(2, (fraction) => seen.push(fraction)); parser.push('out_time_us=100'); parser.push('0000\nprogress=continue\nout_time_us=500000\nprogress=continue\nprogress=end\n'); expect(seen).toEqual([0.5, 0.5, 0.5]);
  });
  it('claims unique versions and cannot replace an externally changed reservation', async () => {
    const root = await temporary(); const first = await claimVersion(root, 'Movie', 'mp4'); const second = await claimVersion(root, 'Movie', 'mp4'); expect(first.rel).toContain('v001'); expect(second.rel).toContain('v002');
    const temporaryFile = path.join(root, 'render.mp4'); await writeFile(temporaryFile, 'rendered'); await first.publish(temporaryFile); await first.remove(); expect(await readFile(first.file, 'utf8')).toBe('rendered');
    await rm(second.file); await writeFile(second.file, 'user data'); await expect(second.publish(first.file)).rejects.toMatchObject({ code: 'conflict' }); await second.remove(); expect(await readFile(second.file, 'utf8')).toBe('user data');
  });
});

describe('job lifecycle', () => {
  it('limits export concurrency, emits monotonic progress, cancels queued/running jobs and writes logs', async () => {
    const root = await temporary(); const queue = new JobQueue(); let active = 0; let max = 0; let start!: () => void; const started = new Promise<void>((resolve) => { start = resolve; });
    const first = queue.enqueue(project(root), 'export', 'First', async (context) => { active++; max = Math.max(max, active); context.log('encoding\n'); context.progress(0.5, 'Encoding'); context.progress(0.2, 'Encoding'); start(); await new Promise<void>((resolve) => context.signal.addEventListener('abort', () => resolve(), { once: true })); active--; });
    const second = queue.enqueue(project(root), 'export', 'Second', async () => { throw new Error('Queued job must not run'); }); await started;
    expect(queue.list().find((job) => job.id === first.jobId)?.progress).toBe(0.5); expect(queue.list().find((job) => job.id === second.jobId)?.status).toBe('queued');
    await queue.cancel(second.jobId); await queue.cancel(first.jobId); expect((await queue.wait(first.jobId)).status).toBe('cancelled'); expect(max).toBe(1); expect(await readFile(path.join(root, `work/logs/${first.jobId}.log`), 'utf8')).toContain('encoding'); await queue.close();
  });
});

it('encodes real synthetic media with speed and black gaps, then probes duration and size', async (context) => {
  const ffmpeg = process.env.CUTROOM_TEST_FFMPEG ?? path.join(homedir(), '.cutroom/tools/ffmpeg/9.0.2/ffmpeg'); const ffprobe = process.env.CUTROOM_TEST_FFPROBE ?? path.join(homedir(), '.cutroom/tools/ffprobe/9.0.2/ffprobe');
  try { await access(ffmpeg); await access(ffprobe); } catch { context.skip('Verified local FFmpeg/ffprobe tools are not installed; no PATH fallback.'); return; }
  const root = await temporary(); await mkdir(path.join(root, 'raw')); const input = path.join(root, 'raw/clip.mp4');
  const generated = await runCommand(ffmpeg, ['-hide_banner', '-nostdin', '-n', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', input], { timeoutMs: 30000 }); expect(generated.code).toBe(0);
  const timeline = doc(); timeline.tracks[3]!.items[0]!.start = 0.5; const output = path.join(root, 'export.mp4'); const plan = compileRender(timeline, preset, { 'raw/clip.mp4': { path: input, hasAudio: true } }, output); let diagnostics = '';
  const encoded = await runCommand(ffmpeg, plan.args, { timeoutMs: 30000, onStderr: (text) => { diagnostics += text; } }); expect(encoded.code, diagnostics).toBe(0);
  const probed = await runCommand(ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', output]); const metadata = JSON.parse(probed.stdout); expect(Math.abs(Number(metadata.format.duration) - 1.5)).toBeLessThanOrEqual(1 / 30); expect(metadata.streams[0]).toMatchObject({ width: 320, height: 180 });
}, 60000);
