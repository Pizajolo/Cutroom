import { expect, it } from 'vitest';
import { access, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { emptyTimeline } from '@main/projects/service';
import { ExportService } from '@main/render/service';
import { JobQueue } from '@main/jobs/queue';
import { runCommand, type RunCommand } from '@main/process/run';
import { defaultGlobalSettings } from '@shared/schema/settings';
import type { ProjectSession } from '@shared/schema/project';
import type { WorkflowRuntime } from '@main/projects/runtime';
import type { MediaService } from '@main/media/service';

it('exports a real trimmed/speed/broll/music mix twice, measures loudness, and cancels without publishing', async (context) => {
  const ffmpeg = process.env.CUTROOM_TEST_FFMPEG ?? path.join(homedir(), '.cutroom/tools/ffmpeg/9.0.2/ffmpeg'); const ffprobe = process.env.CUTROOM_TEST_FFPROBE ?? path.join(homedir(), '.cutroom/tools/ffprobe/9.0.2/ffprobe');
  try { await access(ffmpeg); await access(ffprobe); } catch { context.skip('Verified local FFmpeg/ffprobe are absent; no PATH fallback.'); return; }
  const root = await mkdtemp(path.join(process.env.TMPDIR ?? tmpdir(), 'cutroom-real-export-')); const jobs = new JobQueue();
  try {
    await mkdir(path.join(root, 'raw')); const source = path.join(root, 'raw/clip.mp4');
    const generated = await runCommand(ffmpeg, ['-hide_banner', '-nostdin', '-n', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', source], { timeoutMs: 30_000 }); expect(generated.code).toBe(0);
    const format = { aspect: '16:9', width: 320, height: 180, fps: 30 } as const; const doc = emptyTimeline(format); const base = { createdBy: 'system' as const, userEdited: [] };
    doc.tracks[3]!.items.push({ ...base, type: 'clip', id: 'clip_abcdefghij', src: 'raw/clip.mp4', start: 0, duration: 2, in: 0.5, out: 2.5, speed: 1, volume: 1, muted: false }, { ...base, type: 'clip', id: 'clip_klmnopqrst', src: 'raw/clip.mp4', start: 2, duration: 2, in: 0, out: 4, speed: 2, volume: 1, muted: false });
    doc.tracks[4]!.items.push({ ...base, type: 'clip', id: 'clip_uvwxyzabcd', src: 'raw/clip.mp4', start: 1, duration: 1, in: 1, out: 2, speed: 1, volume: 1, muted: true, crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 } });
    doc.tracks[6]!.items.push({ ...base, type: 'audio', id: 'audio_abcdefghij', src: 'raw/clip.mp4', start: 0, duration: 4, in: 0, out: 4, gain: -12, fadeIn: 0.2, fadeOut: 0.2 });
    const session: ProjectSession = { rootPath: root, looseMediaCount: 0, project: { id: 'project', name: 'Mix', format, defaultEngine: 'hyperframes', createdAt: new Date().toISOString(), folderMap: { raw: 'raw', references: 'references', assets: 'assets', compositions: 'compositions', audio: 'audio', work: 'work', final: 'final' } } }; const settings = defaultGlobalSettings(); settings.snapshots.autoBeforeExport = false;
    const runtime = { projects: { require: () => session, current: () => session }, settings: { get: () => settings }, timeline: () => ({ state: () => ({ doc: structuredClone(doc), revision: 0 }) }), overlays: { available: async () => 'Install Chrome before rendering compositions.', render: async () => { throw new Error('An unavailable overlay must not render'); } }, jobs } as unknown as WorkflowRuntime;
    const media = { probeFile: async () => ({ acodec: 'aac' }), notify: () => {} } as unknown as MediaService;
    const cancellation: { id?: string; interrupted: boolean } = { interrupted: false };
    const run: RunCommand = (binary, args, options) => runCommand(binary, args, { ...options, onStdout: options?.onStdout ? (chunk) => { options.onStdout!(chunk); if (cancellation.id && !cancellation.interrupted) { cancellation.interrupted = true; void jobs.cancel(cancellation.id); } } : undefined });
    const service = new ExportService(runtime, media, async (name) => name === 'ffmpeg' ? ffmpeg : ffprobe, run);
    expect(await service.preflight({ presetId: 'final' })).toMatchObject({ canExport: true, unsupportedItems: [] });
    const first = await service.start({ presetId: 'final', acknowledgeUnsupported: false }); const done = await jobs.wait(first.jobId); expect(done.status, JSON.stringify(done.error)).toBe('done'); expect(done.result).toMatchObject({ rel: 'final/Mix_v001.mp4', durationSec: 4 }); const original = await readFile(path.join(root, 'final/Mix_v001.mp4'));
    const metadata = JSON.parse((await runCommand(ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', path.join(root, 'final/Mix_v001.mp4')])).stdout); expect(Math.abs(Number(metadata.format.duration) - 4)).toBeLessThanOrEqual(1 / 30); expect(metadata.streams.find((stream: { codec_type: string }) => stream.codec_type === 'video')).toMatchObject({ width: 320, height: 180 });
    let measured = ''; const loudness = await runCommand(ffmpeg, ['-hide_banner', '-nostdin', '-i', path.join(root, 'final/Mix_v001.mp4'), '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-'], { timeoutMs: 30_000, onStderr: (chunk) => { measured += chunk; } }); expect(loudness.code).toBe(0); const integrated = [...measured.matchAll(/I:\s*(-?\d+(?:\.\d+)?) LUFS/g)].at(-1); expect(integrated, measured).toBeDefined(); expect(Math.abs(Number(integrated![1]) + 14)).toBeLessThanOrEqual(1.5);
    const second = await service.start({ presetId: 'final', acknowledgeUnsupported: false }); expect((await jobs.wait(second.jobId)).result).toMatchObject({ rel: 'final/Mix_v002.mp4' }); expect(await readFile(path.join(root, 'final/Mix_v001.mp4'))).toEqual(original);
    const third = await service.start({ presetId: 'final', acknowledgeUnsupported: false }); cancellation.id = third.jobId; expect((await jobs.wait(third.jobId)).status).toBe('cancelled'); expect(cancellation.interrupted).toBe(true); expect(await readdir(path.join(root, 'final'))).toEqual(['Mix_v001.mp4', 'Mix_v002.mp4']); expect(await readdir(path.join(root, 'work/exports'))).toEqual([]); expect((await readdir(path.join(root, 'work/logs'))).length).toBe(3);
    cancellation.id = undefined;
    doc.tracks[0]!.items.push({ ...base, type: 'composition', id: 'composition_abcdefghij', start: 0, duration: 1, path: 'compositions/title', engine: 'hyperframes', props: {} });
    expect(await service.preflight({ presetId: 'final' })).toMatchObject({ canExport: true, unsupportedItems: [{ itemId: 'composition_abcdefghij', name: expect.stringContaining('Chrome') }] });
    await expect(service.start({ presetId: 'final', acknowledgeUnsupported: false })).rejects.toMatchObject({ code: 'invalid_request' });
    const withoutOverlay = await service.start({ presetId: 'final', acknowledgeUnsupported: true }); expect((await jobs.wait(withoutOverlay.jobId)).result).toMatchObject({ rel: 'final/Mix_v003.mp4' });
  } finally { await jobs.close(); await rm(root, { recursive: true, force: true }); }
}, 120_000);
