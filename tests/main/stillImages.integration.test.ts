import { expect, it } from 'vitest';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { MediaService } from '@main/media/service';
import { ProjectService } from '@main/projects/service';
import { TimelineService } from '@main/timeline/service';
import { ExportService } from '@main/render/service';
import { JobQueue } from '@main/jobs/queue';
import { runCommand } from '@main/process/run';
import { createRequestHandler, reply } from '@main/ipc/validation';
import { contract } from '@shared/ipc/contract';
import { defaultGlobalSettings } from '@shared/schema/settings';
import type { WorkflowRuntime } from '@main/projects/runtime';

// Real ffprobe establishes the zero-duration still-image case; frame pixels,
// not just container duration, establish that the exported image stays visible.
it.for(['png', 'jpg'])('adds a probed %s through timeline.apply and holds its picture across trims, speed, gaps and export ranges', { timeout: 60_000 }, async (extension, context) => {
  const ffmpeg = process.env.CUTROOM_TEST_FFMPEG ?? path.join(homedir(), '.cutroom/tools/ffmpeg/9.0.2/ffmpeg');
  const ffprobe = process.env.CUTROOM_TEST_FFPROBE ?? path.join(homedir(), '.cutroom/tools/ffprobe/9.0.2/ffprobe');
  try { await access(ffmpeg); await access(ffprobe); } catch { context.skip('Verified local FFmpeg/ffprobe are absent; no PATH fallback.'); return; }
  const root = await mkdtemp(path.join(process.env.TMPDIR ?? tmpdir(), 'cutroom-still-'));
  const resolveTool = async (name: string): Promise<string> => { if (name === 'ffmpeg') return ffmpeg; if (name === 'ffprobe') return ffprobe; throw new Error('Unexpected tool'); };
  const media = new MediaService({ resolveTool, url: (_id, rel) => `http://127.0.0.1/${rel}` });
  const jobs = new JobQueue(); let timeline: TimelineService | undefined;
  try {
    const projects = new ProjectService({ home: path.join(root, 'home'), media });
    const session = await projects.create({ parentGrant: (await projects.grants.issue(root, 'projectParent')).grantId, name: 'Still', format: { aspect: '16:9', width: 320, height: 180, fps: 30 }, defaultEngine: 'hyperframes' });
    const rel = `raw/red.${extension}`;
    const source = path.join(session.rootPath, rel);
    expect((await runCommand(ffmpeg, ['-hide_banner', '-nostdin', '-n', '-f', 'lavfi', '-i', 'color=c=red:s=320x180:r=30', '-frames:v', '1', source])).code).toBe(0);
    const original = await readFile(source);
    const listed = (await media.list()).find((file) => file.rel === rel);
    expect(listed).toMatchObject({ kind: 'image', probe: { duration: 0, width: 320, height: 180 } });
    expect(await media.sourceDurations()).not.toHaveProperty(rel);
    timeline = await TimelineService.load(session.rootPath, { sourceDurations: () => media.sourceDurations() });
    const service = timeline;
    const apply = createRequestHandler(contract.invoke['timeline.apply'], ({ ops, label, baseRevision }) => service.apply(ops, { actor: 'user', label, baseRevision }), { validateResponse: true });
    const sender = { frameUrl: 'app://cutroom/', isMainFrame: true, destroyed: false };
    const applied = await reply(() => apply(sender, { ops: [{ type: 'addItem', trackId: 'video', item: { type: 'clip', id: 'clip_abcdefghij', src: rel, start: 1, duration: 5, in: 2, out: 12, speed: 2, volume: 1, muted: false, createdBy: 'user', userEdited: [] } }], label: 'Add still', baseRevision: 0 }));
    expect(applied).toMatchObject({ ok: true, data: { revision: 1 } });
    const settings = defaultGlobalSettings(); settings.snapshots.autoBeforeExport = false;
    const runtime = { projects, jobs, timeline: () => service, settings: { get: () => settings }, overlays: { available: async () => null } } as unknown as WorkflowRuntime;
    const exports = new ExportService(runtime, media, resolveTool);
    const first = await exports.start({ presetId: 'final', range: { start: 0, end: 7 }, acknowledgeUnsupported: false });
    const done = await jobs.wait(first.jobId); expect(done.status, JSON.stringify(done.error)).toBe('done');
    const output = path.join(session.rootPath, 'final/Still_v001.mp4');
    const pixel = async (file: string, time: number, name: string): Promise<number[]> => {
      const destination = path.join(root, `${name}.rgb`);
      const result = await runCommand(ffmpeg, ['-hide_banner', '-nostdin', '-n', '-ss', String(time), '-i', file, '-vf', 'scale=1:1', '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', destination]);
      expect(result.code).toBe(0); const bytes = await readFile(destination); expect(bytes.length).toBe(3); return [...bytes];
    };
    for (const time of [1.1, 3.5, 5.9]) { const [red, green, blue] = await pixel(output, time, `visible-${time}`); expect(red).toBeGreaterThan(200); expect(green).toBeLessThan(30); expect(blue).toBeLessThan(30); }
    for (const time of [0.5, 6.5]) expect(Math.max(...await pixel(output, time, `gap-${time}`))).toBeLessThan(10);
    const ranged = await exports.start({ presetId: 'final', range: { start: 2, end: 5 }, acknowledgeUnsupported: false });
    expect((await jobs.wait(ranged.jobId)).status).toBe('done');
    expect((await pixel(path.join(session.rootPath, 'final/Still_v002.mp4'), 2.9, 'ranged-end'))[0]).toBeGreaterThan(200);
    expect(await readFile(source)).toEqual(original);
  } finally { await jobs.close(); await timeline?.close(); media.close(); await rm(root, { recursive: true, force: true }); }
});
