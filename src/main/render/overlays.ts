import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, copyFile, link, lstat, mkdir, mkdtemp, open, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { z } from 'zod/v3';
import { IpcFailure } from '@shared/ipc/errors';
import type { TimelineItem } from '@shared/schema/timeline';
import { propsDocSchema } from '@shared/schema/props';
import { applyProps, type PropValues } from '@shared/props/applyProps';
import { atomicWrite, managedPath, readManaged } from '../fs/managed';
import type { WorkflowRuntime } from '../projects/runtime';
import type { JobContext } from '../jobs/queue';
import { runCommand, type RunCommand } from '../process/run';

const require = createRequire(import.meta.url);
export type OverlayItem = Extract<TimelineItem, { type: 'text' | 'caption' | 'composition' }>;
export interface RenderOverlay { itemId: string; path: string; start: number; duration: number; track: string }
export async function resolveChrome(resolveTool: (name: string) => Promise<string>): Promise<string> {
  try { return await resolveTool('chrome-headless-shell'); } catch { /* No reviewed pin installed: fixed system location only. */ }
  const fixed = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  try { const canonical = await realpath(fixed); if (!(await lstat(canonical)).isFile()) throw new Error(); await access(canonical, constants.X_OK); return canonical; }
  catch { throw new IpcFailure({ code: 'unavailable', message: 'Composition rendering needs Google Chrome at /Applications/Google Chrome.app or a verified Chrome tool. Install Chrome and retry.' }); }
}
export class OverlayService {
  constructor(private readonly options: { runtime: WorkflowRuntime; compositionsRoot: string; resolveTool: (name: string) => Promise<string>; run?: RunCommand; chrome?: () => Promise<string> }) {}
  async available(item: OverlayItem): Promise<string | null> {
    if (item.type === 'composition' && item.engine === 'remotion' && !this.options.runtime.settings.get().remotionLicenseAcknowledgedAt) return 'Acknowledge the Remotion licence in Settings → Render presets before rendering.';
    try { await (this.options.chrome?.() ?? resolveChrome(this.options.resolveTool)); return null; } catch (error) { return error instanceof IpcFailure ? error.message : 'Chrome is unavailable.'; }
  }
  private async source(root: string, item: OverlayItem): Promise<string> {
    if (item.type === 'composition') { if (!/^compositions\/[A-Za-z0-9][A-Za-z0-9_-]*\/?$/.test(item.path)) throw new IpcFailure({ code: 'forbidden', message: 'Composition paths must select one folder inside compositions/.' }); return managedPath(root, item.path.replace(/\/$/, '')); }
    return managedPath(this.options.compositionsRoot, `builtin/${item.type === 'text' ? 'text-layer' : 'captions'}`);
  }
  private values(item: OverlayItem): PropValues {
    if (item.type === 'composition') return item.props;
    if (item.type === 'caption') return { captions: { words: JSON.stringify(item.words.map(({ text, start, end }) => ({ text, start, end }))), preset: item.stylePreset, highlight: item.highlight ?? '#f6d36d' } };
    return { text: { content: item.text, fontFamily: item.style.fontFamily, fontSize: item.style.fontSize, fontWeight: item.style.fontWeight, color: item.style.color, align: item.style.align, x: item.layout.x, y: item.layout.y, w: item.layout.w, h: item.layout.h } };
  }
  private async files(source: string): Promise<{ rel: string; file: string }[]> {
    const files: { rel: string; file: string }[] = []; let bytes = 0;
    const walk = async (rel = '', depth = 0): Promise<void> => {
      if (depth > 16 || files.length > 5000) throw new IpcFailure({ code: 'invalid_request', message: 'The composition is too large.' });
      for (const entry of await readdir(rel ? await managedPath(source, rel) : source, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue; const child = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isSymbolicLink()) throw new IpcFailure({ code: 'forbidden', message: 'Composition rendering does not follow symlinks.' });
        if (entry.isDirectory()) { if (entry.name !== 'node_modules') await walk(child, depth + 1); }
        else if (entry.isFile()) { const file = await managedPath(source, child); bytes += (await lstat(file)).size; if (bytes > 256 * 1024 * 1024) throw new IpcFailure({ code: 'invalid_request', message: 'Composition assets exceed 256 MB.' }); files.push({ rel: child, file }); }
      }
    }; await walk(); return files.sort((a, b) => a.rel.localeCompare(b.rel));
  }
  private async verify(file: string, duration: number, format: { width: number; height: number; fps: number }, signal: AbortSignal): Promise<void> {
    const invalid = () => new IpcFailure({ code: 'unavailable', message: 'The composition output failed verification (dimensions, timing or transparency). No new cache file was published. Review existing cache files in Storage settings.' });
    const before = await lstat(file); if (!before.isFile() || !before.size) throw invalid();
    const result = await (this.options.run ?? runCommand)(await this.options.resolveTool('ffprobe'), ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_format', '-show_streams', '-of', 'json', file], { signal, timeoutMs: 30_000 });
    let parsed: unknown; try { parsed = JSON.parse(result.stdout); } catch { throw invalid(); }
    const metadata = z.object({ format: z.object({ duration: z.coerce.number().finite().positive() }), streams: z.array(z.object({ codec_type: z.string(), width: z.number().optional(), height: z.number().optional(), pix_fmt: z.string().optional(), r_frame_rate: z.string().optional() })) }).safeParse(parsed);
    const after = await lstat(file);
    if (result.code !== 0 || !metadata.success || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.ctimeMs !== after.ctimeMs) throw invalid();
    const stream = metadata.data.streams.find((stream) => stream.codec_type === 'video');
    const rate = stream?.r_frame_rate?.split('/').map(Number); const fps = rate?.length === 2 ? rate[0]! / rate[1]! : NaN;
    if (stream?.width !== format.width || stream.height !== format.height || !/^(?:yuva|gbrap|rgba|bgra|argb|abgr|ya\d)/.test(stream.pix_fmt ?? '') || !Number.isFinite(fps) || Math.abs(fps - format.fps) > 0.001 || Math.abs(metadata.data.format.duration - duration) > 1 / format.fps + 0.005) throw invalid();
    signal.throwIfAborted();
  }
  async render(root: string, item: OverlayItem, format: { width: number; height: number; fps: number }, context: JobContext): Promise<{ path: string; reused: boolean }> {
    const unavailable = await this.available(item); if (unavailable) throw new IpcFailure({ code: item.type === 'composition' && item.engine === 'remotion' && !this.options.runtime.settings.get().remotionLicenseAcknowledgedAt ? 'invalid_request' : 'unavailable', message: unavailable });
    const chrome = await (this.options.chrome?.() ?? resolveChrome(this.options.resolveTool)); const source = await this.source(root, item); const files = await this.files(source);
    const schema = propsDocSchema.parse(JSON.parse(await readManaged(source, 'props.json'))); const values = structuredClone(this.values(item));
    for (const element of schema.elements) values[element.id] = { ...Object.fromEntries(Object.entries(element.props).map(([name, prop]) => [name, prop.default])), ...values[element.id] };
    const hash = createHash('sha256').update('cutroom-overlays-v2:hyperframes0.9.2:remotion4.0.540').update(JSON.stringify([item.type, item.type === 'composition' ? item.engine : 'hyperframes', item.type === 'composition' ? item.compositionId : null, values, item.duration, format]));
    const captured = new Map<string, Buffer>();
    for (const file of files) {
      const handle = await open(await managedPath(source, file.rel), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try { const info = await handle.stat(); if (!info.isFile() || info.size > 256 * 1024 * 1024) throw new Error('Invalid composition asset'); const bytes = await handle.readFile(); const after = await handle.stat(); if (info.size !== after.size || info.ctimeMs !== after.ctimeMs) throw new IpcFailure({ code: 'conflict', message: 'The composition changed during preparation. Retry rendering.' }); captured.set(file.rel, bytes); hash.update(file.rel); hash.update(bytes); } finally { await handle.close(); }
    }
    const key = hash.digest('hex'); const cacheRel = `work/renders/${key}.mov`; const cache = await managedPath(root, cacheRel);
    const existing = await lstat(cache).catch((error) => { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null; throw error; });
    if (existing?.isFile() && existing.size > 0) { await this.verify(cache, item.duration, format, context.signal); return { path: cache, reused: true }; }
    if (existing) throw new IpcFailure({ code: 'conflict', message: 'The render cache contains an invalid entry. Review it in Storage settings.' });
    const base = await managedPath(root, 'work/renders'); await mkdir(base, { recursive: true, mode: 0o700 }); const temporary = await mkdtemp(path.join(base, 'overlay-'));
    try {
      const stage = path.join(temporary, 'source'); await mkdir(stage);
      for (const file of files) { const destination = await managedPath(stage, file.rel); await mkdir(path.dirname(destination), { recursive: true }); await writeFile(destination, captured.get(file.rel)!, { flag: 'wx', mode: 0o600 }); }
      const output = path.join(temporary, 'overlay.mov'); const run = this.options.run ?? runCommand;
      if (item.type === 'composition' && item.engine === 'remotion') {
        const manifest = JSON.parse(await readManaged(stage, 'manifest.json')) as { entry?: unknown; compositionId?: unknown };
        if (manifest.entry !== 'index.tsx') throw new IpcFailure({ code: 'invalid_request', message: 'Remotion compositions require an index.tsx entry.' });
        // Validate types/bounds through the shared binding contract without executing authored JS.
        const validator = new JSDOM(`<main>${schema.elements.map((element) => `<i data-cut-id=${JSON.stringify(element.id)}></i>`).join('')}</main>`); try { applyProps(validator.window.document, schema, values); } finally { validator.window.close(); }
        const binaries = path.join(temporary, 'binaries'); await mkdir(binaries);
        if (process.platform !== 'darwin') throw new IpcFailure({ code: 'unavailable', message: 'Remotion composition rendering is currently supported on macOS only.' });
        const compositor = require(`@remotion/compositor-darwin-${process.arch}`) as { dir: string };
        for (const name of await readdir(compositor.dir)) if (name === 'remotion' || name.endsWith('.dylib')) await copyFile(path.join(compositor.dir, name), path.join(binaries, name), constants.COPYFILE_EXCL);
        for (const tool of ['ffmpeg', 'ffprobe']) await symlink(await this.options.resolveTool(tool), path.join(binaries, tool));
        const request = path.join(temporary, 'request.json'); await writeFile(request, JSON.stringify({ entry: path.join(stage, 'index.tsx'), bundle: path.join(temporary, 'bundle'), binaries, chrome, output, compositionId: item.compositionId ?? (typeof manifest.compositionId === 'string' ? manifest.compositionId : 'Title'), width: format.width, height: format.height, fps: format.fps, duration: item.duration, props: values }), { flag: 'wx', mode: 0o600 });
        const worker = fileURLToPath(new URL('./remotionWorker.mjs', import.meta.url));
        const result = await run(process.execPath, [worker, request], { signal: context.signal, timeoutMs: 3_600_000, cwd: temporary, env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: temporary, TMPDIR: temporary, ELECTRON_RUN_AS_NODE: '1' }, onStdout: () => {}, onStderr: () => {} });
        if (result.code !== 0) throw new IpcFailure({ code: 'unavailable', message: 'Remotion could not render this composition. Check its entry, props and Chrome installation.' });
      } else {
        await copyFile(require.resolve('gsap/dist/gsap.min.js'), path.join(stage, 'cutroom-gsap.js'), constants.COPYFILE_EXCL);
        const html = (await readManaged(stage, 'index.html')).replaceAll('cutroom:gsap', './cutroom-gsap.js').replace(/https?:\/\/127\.0\.0\.1:\d+\/k\/[a-f0-9]+\/runtime\/gsap.min.js/g, './cutroom-gsap.js');
        const dom = new JSDOM(html); try {
          applyProps(dom.window.document, schema, values); const document = dom.window.document; const root = document.querySelector('[data-composition-id]'); if (!root) throw new Error('Missing composition root');
          root.setAttribute('data-duration', String(item.duration)); root.setAttribute('data-width', String(format.width)); root.setAttribute('data-height', String(format.height)); root.setAttribute('data-fps', String(format.fps)); (root as HTMLElement).style.width = `${format.width}px`; (root as HTMLElement).style.height = `${format.height}px`;
          document.querySelectorAll('.clip').forEach((clip) => { clip.setAttribute('data-duration', String(item.duration)); });
          const script = document.createElement('script'); script.textContent = `window.__cutroomProps?.(${JSON.stringify(values).replaceAll('<', '\\u003c')});for(const tl of Object.values(window.__timelines||{})){tl.to({},{duration:${item.duration}},0);if(window.__cutroomSeek)tl.eventCallback('onUpdate',function(){window.__cutroomSeek(this.time())});}`; document.body.append(script);
          // Disable all external network resources in the isolated render page.
          const csp = document.createElement('meta'); csp.httpEquiv = 'Content-Security-Policy'; csp.content = "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'none'; object-src 'none'; frame-src 'none'"; document.head.prepend(csp);
          await atomicWrite(stage, 'index.html', dom.serialize());
        } finally { dom.window.close(); }
        const cli = path.join(path.dirname(require.resolve('hyperframes/package.json')), 'bin/hyperframes.mjs'); const [ffmpeg, ffprobe] = await Promise.all([this.options.resolveTool('ffmpeg'), this.options.resolveTool('ffprobe')]);
        const result = await run(process.execPath, [cli, 'render', stage, '--format', 'mov', '--prores-profile', '4444', '--fps', String(format.fps), '--workers', '1', '--output', output, '--no-best-effort', '--frames-cache-dir', 'off'], { signal: context.signal, timeoutMs: 3_600_000, cwd: temporary, env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: temporary, TMPDIR: temporary, ELECTRON_RUN_AS_NODE: '1', HYPERFRAMES_BROWSER_PATH: chrome, PRODUCER_HEADLESS_SHELL_PATH: chrome, HYPERFRAMES_FFMPEG_PATH: ffmpeg, HYPERFRAMES_FFPROBE_PATH: ffprobe, DO_NOT_TRACK: '1' }, onStdout: () => {}, onStderr: () => {} });
        if (result.code !== 0) throw new IpcFailure({ code: 'unavailable', message: 'HyperFrames could not render this composition. Check the markup, local assets and Chrome installation.' });
      }
      await this.verify(output, item.duration, format, context.signal);
      try { await link(output, await managedPath(root, cacheRel)); } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
        const winner = await managedPath(root, cacheRel); await this.verify(winner, item.duration, format, context.signal); return { path: winner, reused: true };
      }
      return { path: cache, reused: false };
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }
  async start(itemId: string): Promise<{ jobId: string }> {
    const runtime = this.options.runtime; const project = runtime.projects.require(); const state = runtime.timeline().state(); const item = state.doc.tracks.flatMap((track) => track.items).find((item) => item.id === itemId);
    if (!item || !['composition', 'text', 'caption'].includes(item.type)) throw new IpcFailure({ code: 'not_found', message: 'Composition item not found.' });
    const overlay = item as OverlayItem; const unavailable = await this.available(overlay); if (unavailable) throw new IpcFailure({ code: overlay.type === 'composition' && overlay.engine === 'remotion' && !runtime.settings.get().remotionLicenseAcknowledgedAt ? 'invalid_request' : 'unavailable', message: unavailable });
    return runtime.jobs.enqueue(project, 'composition_render', 'Render composition', async (context) => { context.progress(0.05, 'Preparing composition'); const result = await this.render(project.rootPath, overlay, state.doc.format, context); return { rel: path.relative(project.rootPath, result.path), reused: result.reused }; });
  }
}
