import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { applyProps } from '@shared/props/applyProps';
import { propsDocSchema } from '@shared/schema/props';
import { defaultGlobalSettings } from '@shared/schema/settings';
import { guardAgentFile, agentPolicy } from '@main/agent/policy';
import { ChangeReview } from '@main/agent/review';
import { TimelineService } from '@main/timeline/service';
import { emptyTimeline } from '@main/projects/service';
import { atomicJson } from '@main/fs/managed';
import { downloadArgs, mapUrlMetadata, parseDownloadProgress, UrlImportService } from '@main/urlImport/service';
import { JobQueue } from '@main/jobs/queue';
import { OverlayService, type OverlayItem } from '@main/render/overlays';
import { compileRender } from '@main/render/compiler';
import { BUILTIN_PRESETS } from '@main/render/presets';
import { runCommand } from '@main/process/run';
import type { WorkflowRuntime } from '@main/projects/runtime';
import type { MediaService } from '@main/media/service';
import type { ProjectSession } from '@shared/schema/project';
import type { TimelineItem } from '@shared/schema/timeline';

const roots: string[] = []; const queues: JobQueue[] = [];
const format = { aspect: '16:9', width: 320, height: 180, fps: 30 } as const;
async function temporary() { const root = await mkdtemp(path.join(process.env.TMPDIR ?? tmpdir(), 'cutroom-boundaries-')); roots.push(root); return root; }
afterEach(async () => { await Promise.all(queues.splice(0).map((queue) => queue.close())); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const props = propsDocSchema.parse({ version: 1, elements: [{ id: 'title', name: 'Title', kind: 'text', props: { content: { type: 'text', bind: 'text', default: 'Default' }, size: { type: 'number', bind: 'css:--size', default: 30, min: 10, max: 100 } } }] });
const clip: TimelineItem = { type: 'clip', id: 'clip_abcdefghij', src: 'raw/example.mp4', start: 0, duration: 3, in: 0, out: 3, speed: 1, volume: 1, muted: false, createdBy: 'system', userEdited: [] };
function session(rootPath: string): ProjectSession { return { rootPath, looseMediaCount: 0, project: { id: 'project', name: 'Test', defaultEngine: 'hyperframes', format, createdAt: new Date().toISOString(), folderMap: { raw: 'raw', references: 'references', assets: 'assets', compositions: 'compositions', audio: 'audio', work: 'work', final: 'final' } } }; }

describe('shared editable props', () => {
  it('writes literal text, defaults and bounded CSS without evaluating HTML', () => {
    const dom = new JSDOM('<h1 data-cut-id="title"></h1>'); try { applyProps(dom.window.document, props, { title: { content: '<img src=x onerror=alert(1)>' } }); expect(dom.window.document.querySelector('h1')!.textContent).toContain('<img'); expect(dom.window.document.querySelector('img')).toBeNull(); expect(dom.window.document.querySelector('h1')!.style.getPropertyValue('--size')).toBe('30'); } finally { dom.window.close(); }
  });
  it('rejects unknown values and invalid numbers before any mutation', () => {
    const dom = new JSDOM('<h1 data-cut-id="title">Original</h1>'); try { expect(() => applyProps(dom.window.document, props, { title: { content: 'Changed', size: 101 } })).toThrow(); expect(dom.window.document.querySelector('h1')!.textContent).toBe('Original'); expect(() => applyProps(dom.window.document, props, { unknown: {} })).toThrow(); } finally { dom.window.close(); }
  });
});

describe('agent file scope and targeted live review', () => {
  it('rejects original, traversal, timeline and symlink writes while permitting authored work', async () => {
    const root = await temporary(); for (const name of ['work', 'raw', 'compositions']) await mkdir(path.join(root, name)); await writeFile(path.join(root, 'raw/source.mp4'), 'original'); await symlink('../raw', path.join(root, 'work/alias'));
    for (const file_path of ['raw/source.mp4', '../escape', 'timeline.json', 'work/alias/source.mp4']) await expect(guardAgentFile(root, 'Write', { file_path }, 'edit')).rejects.toThrow();
    await expect(guardAgentFile(root, 'Write', { file_path: 'compositions/title/index.html' }, 'edit')).resolves.toBeUndefined(); await expect(guardAgentFile(root, 'Write', { file_path: 'work/test' }, 'ask')).rejects.toThrow(); expect(await readFile(path.join(root, 'raw/source.mp4'), 'utf8')).toBe('original');
    const policy = agentPolicy(root, 'ask', defaultGlobalSettings()); expect(policy.disallowedTools).toContain('Bash'); expect(policy.tools).not.toContain('Write'); expect(policy.sandbox?.allowUnsandboxedCommands).toBe(false);
  });
  it('reverts only changed properties, keeps later unrelated user edits, and never reapplies Keep', async () => {
    const root = await temporary(); await atomicJson(root, 'timeline.json', emptyTimeline(format)); const review = new ChangeReview(); const timeline = await TimelineService.load(root, { onChanged: (change) => { review.record(change); } });
    await timeline.apply([{ type: 'addItem', trackId: 'video', item: clip }], { actor: 'system', label: 'Import' });
    await timeline.apply([{ type: 'setProps', itemId: clip.id, patch: { volume: 0.5 } }], { actor: 'agent:test', label: 'Volume', requestId: 'first' });
    await timeline.apply([{ type: 'setProps', itemId: clip.id, patch: { note: 'User note' } }], { actor: 'user', label: 'Note' });
    const before = timeline.state().revision; await review.revert(timeline, 'first'); const item = timeline.state().doc.tracks[3]!.items[0]!; expect(item).toMatchObject({ volume: 1, note: 'User note' }); expect(timeline.state().revision).toBe(before + 1);
    review.keep('first'); expect(timeline.state().revision).toBe(before + 1); await timeline.close();
  });
  it('returns a path conflict without mutating, then honours explicit current/original resolution', async () => {
    const root = await temporary(); await atomicJson(root, 'timeline.json', emptyTimeline(format)); const review = new ChangeReview(); const timeline = await TimelineService.load(root, { onChanged: (change) => { review.record(change); } });
    await timeline.apply([{ type: 'addItem', trackId: 'video', item: clip }], { actor: 'system', label: 'Import' });
    await timeline.apply([{ type: 'setProps', itemId: clip.id, patch: { volume: 0.5 } }], { actor: 'agent:test', label: 'Volume', requestId: 'conflict' });
    await timeline.apply([{ type: 'setProps', itemId: clip.id, patch: { volume: 0.2 } }], { actor: 'user', label: 'My volume' }); const before = timeline.state();
    await expect(review.revert(timeline, 'conflict')).rejects.toMatchObject({ code: 'conflict' }); expect(timeline.state()).toEqual(before);
    await review.revert(timeline, 'conflict', undefined, 'restoreOriginal'); expect(timeline.state().doc.tracks[3]!.items[0]).toMatchObject({ volume: 1 }); await timeline.close();
  });
});

describe('URL download contracts', () => {
  it('handles unknown totals, zero metadata dimensions and safe URL argument boundaries', () => {
    expect(parseDownloadProgress('CUTROOM|123|NA|None|NA|NA|end')).toEqual({ bytes: 123, total: null, rate: null, eta: null }); expect(parseDownloadProgress('CUTROOM|123|NA|1000|12|3|end')).toMatchObject({ total: 1000, rate: 12, eta: 3 }); expect(parseDownloadProgress('CUTROOM|NaN|0|0|0|0|end')).toBeNull();
    const metadata = mapUrlMetadata({ title: 'Video', formats: [{ format_id: 'audio', ext: 'm4a', width: 0, height: 0, fps: 0, vcodec: 'none', acodec: 'aac' }] }); expect(metadata.formats[1]).toMatchObject({ id: 'audio', ext: 'm4a' });
    const args = downloadArgs('https://example.com/watch?v=x&list=y', 'best', '/private/work', '/verified/ffmpeg'); expect(args.slice(-2)).toEqual(['--', 'https://example.com/watch?v=x&list=y']); expect(args).toContain('--ignore-config'); expect(() => downloadArgs('file:///etc/passwd', 'best', '/work', '/ffmpeg')).toThrow();
  });
  it('downloads privately, appends rights provenance, imports without replacing originals, and cleans temporary files', async () => {
    const root = await temporary(); await mkdir(path.join(root, 'raw')); await mkdir(path.join(root, '.cutroom')); await writeFile(path.join(root, 'raw/video.mp4'), 'original'); const project = session(root); const jobs = new JobQueue(); queues.push(jobs); const notifications: string[][] = [];
    const runtime = { projects: { require: () => project, current: () => project }, jobs } as unknown as WorkflowRuntime;
    const service = new UrlImportService({ runtime, media: { notify: (rels: string[]) => notifications.push(rels) } as unknown as MediaService, resolveTool: async (name) => `/verified/${name}`, run: async (_binary, args, options) => {
      if (args.includes('-J')) return { code: 0, stdout: JSON.stringify({ title: 'Public video', formats: [] }) }; const output = args[args.indexOf('-o') + 1]!; await writeFile(path.join(path.dirname(output), 'video.mp4'), 'downloaded'); options?.onStdout?.('CUTROOM|10|10|10|2|0|end\n'); return { code: 0, stdout: '' };
    } });
    await expect(service.download({ url: 'https://example.com/v', formatId: 'best', destination: 'raw', rightsConfirmed: false as true })).rejects.toMatchObject({ code: 'forbidden' });
    const started = await service.download({ url: 'https://example.com/v', formatId: 'best', destination: 'raw', rightsConfirmed: true }); const done = await jobs.wait(started.jobId); expect(done.status, JSON.stringify(done.error)).toBe('done'); expect(done.result).toMatchObject({ rel: 'raw/video-2.mp4' }); expect(await readFile(path.join(root, 'raw/video.mp4'), 'utf8')).toBe('original'); expect(await readdir(path.join(root, 'work/downloads'))).toEqual([]); expect(notifications).toEqual([['raw/video-2.mp4']]); expect(JSON.parse((await readFile(path.join(root, '.cutroom/provenance.jsonl'), 'utf8')).trim())).toMatchObject({ url: 'https://example.com/v', rel: 'raw/video-2.mp4' });
  });
});

describe('composition render cache and export placement', () => {
  it('uses temporary bound HTML, explicit verified tools, content cache and exclusive generated output', async () => {
    const root = await temporary(); const source = path.join(root, 'compositions/title'); await mkdir(source, { recursive: true }); await writeFile(path.join(source, 'props.json'), JSON.stringify(props)); await writeFile(path.join(source, 'index.html'), '<html><head><script src="cutroom:gsap"></script></head><body><main data-composition-id="title"><h1 data-cut-id="title"></h1></main></body></html>'); const original = await readFile(path.join(source, 'index.html'));
    const runtime = { settings: { get: () => defaultGlobalSettings() } } as unknown as WorkflowRuntime; let runs = 0;
    const service = new OverlayService({ runtime, compositionsRoot: root, chrome: async () => '/fixed/Chrome', resolveTool: async (name) => `/verified/${name}`, run: async (binary, args, options) => { if (binary === '/verified/ffprobe') return { code: 0, stdout: JSON.stringify({ format: { duration: '2.000' }, streams: [{ codec_type: 'video', width: 320, height: 180, pix_fmt: 'yuva444p12le', r_frame_rate: '30/1' }] }) }; runs++; const stage = args[2]!; const html = await readFile(path.join(stage, 'index.html'), 'utf8'); expect(html).toContain('&lt;Title&gt;'); expect(html).not.toContain('cutroom:gsap'); expect(options?.env?.HYPERFRAMES_FFMPEG_PATH).toBe('/verified/ffmpeg'); expect(options?.env?.HYPERFRAMES_BROWSER_PATH).toBe('/fixed/Chrome'); await writeFile(args[args.indexOf('--output') + 1]!, 'transparent-overlay'); return { code: 0, stdout: '' }; } });
    const item: OverlayItem = { type: 'composition', id: 'composition_abcdefghij', start: 1, duration: 2, createdBy: 'system', userEdited: [], engine: 'hyperframes', path: 'compositions/title', props: { title: { content: '<Title>' } } }; const context = { id: 'job', project: session(root), signal: new AbortController().signal, progress: () => {}, log: () => {} };
    const first = await service.render(root, item, format, context); expect(first.reused).toBe(false); const second = await service.render(root, item, format, context); expect(second).toEqual({ ...first, reused: true }); expect(runs).toBe(1); expect(await readFile(path.join(source, 'index.html'))).toEqual(original); expect(await readdir(path.join(root, 'work/renders'))).toEqual([path.basename(first.path)]);
    const doc = emptyTimeline(format); doc.tracks[0]!.items.push(item); const plan = compileRender(doc, BUILTIN_PRESETS[0]!, {}, '/output.mp4', undefined, { [item.id]: { path: first.path } }); expect(plan.args).toContain(first.path); expect(plan.filterGraph).toContain('setpts=PTS-STARTPTS+1/TB'); expect(plan.filterGraph).toContain("lt(t,3)");
  });
  it.each(['opaque', 'dimensions', 'duration', 'fps', 'malformed', 'exit'])('refuses %s outputs before publication and never silently replaces a corrupt cache', async (failure) => {
    const root = await temporary(); const source = path.join(root, 'compositions/title'); await mkdir(source, { recursive: true }); await writeFile(path.join(source, 'props.json'), JSON.stringify(props)); await writeFile(path.join(source, 'index.html'), '<main data-composition-id="title"><h1 data-cut-id="title"></h1></main>');
    let invalid = true;
    const service = new OverlayService({ runtime: { settings: { get: () => defaultGlobalSettings() } } as unknown as WorkflowRuntime, compositionsRoot: root, chrome: async () => '/Chrome', resolveTool: async (name) => `/verified/${name}`, run: async (binary, args) => {
      if (binary !== '/verified/ffprobe') { await writeFile(args[args.indexOf('--output') + 1]!, 'overlay'); return { code: 0, stdout: '' }; }
      const bad = invalid ? failure : '';
      return { code: bad === 'exit' ? 1 : 0, stdout: bad === 'malformed' ? '{' : JSON.stringify({ format: { duration: bad === 'duration' ? '8' : '2' }, streams: [{ codec_type: 'video', width: bad === 'dimensions' ? 640 : 320, height: 180, pix_fmt: bad === 'opaque' ? 'yuv444p12le' : 'yuva444p12le', r_frame_rate: bad === 'fps' ? '25/1' : '30/1' }] }) };
    } });
    const item: OverlayItem = { type: 'composition', id: 'composition_abcdefghij', start: 0, duration: 2, createdBy: 'system', userEdited: [], engine: 'hyperframes', path: 'compositions/title', props: {} }; const context = { id: 'job', project: session(root), signal: new AbortController().signal, progress: () => {}, log: () => {} };
    await expect(service.render(root, item, format, context)).rejects.toMatchObject({ code: 'unavailable' }); expect(await readdir(path.join(root, 'work/renders'))).toEqual([]);
    invalid = false; const valid = await service.render(root, item, format, context); const original = await readFile(valid.path); invalid = true;
    await expect(service.render(root, item, format, context)).rejects.toMatchObject({ code: 'unavailable' }); expect(await readFile(valid.path)).toEqual(original);
  });
  it('rejects symlink assets before invoking a renderer', async () => {
    const root = await temporary(); await mkdir(path.join(root, 'compositions/title'), { recursive: true }); await symlink(root, path.join(root, 'compositions/title/escape')); const service = new OverlayService({ runtime: { settings: { get: () => defaultGlobalSettings() } } as unknown as WorkflowRuntime, compositionsRoot: root, chrome: async () => '/Chrome', resolveTool: async () => '/tool', run: async () => { throw new Error('Must not execute'); } });
    await expect(service.render(root, { type: 'composition', id: 'composition_abcdefghij', start: 0, duration: 1, createdBy: 'user', userEdited: [], engine: 'hyperframes', path: 'compositions/title', props: {} }, format, { id: 'job', project: session(root), signal: new AbortController().signal, progress: () => {}, log: () => {} })).rejects.toMatchObject({ code: 'forbidden' });
  });
});

it('does not spawn an already-aborted command and terminates a real child on abort', async () => {
  const aborted = new AbortController(); aborted.abort(); await expect(runCommand('/missing/binary', [], { signal: aborted.signal })).rejects.toThrow('before it started');
  const controller = new AbortController(); const running = runCommand(process.execPath, ['-e', 'process.stdout.write("ready");setInterval(()=>{},1000)'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, signal: controller.signal, timeoutMs: 10000, onStdout: () => controller.abort() }); await expect(running).rejects.toThrow('cancelled');
});
