import { link, lstat, mkdir, mkdtemp, open, rm } from 'node:fs/promises';
import path from 'node:path';
import { IpcFailure, type InvokeReq } from '@shared/ipc/contract';
import type { ExportPreflight } from '@shared/schema/export';
import { managedPath } from '../fs/managed';
import { resolveInProject } from '../fs/safePath';
import type { WorkflowRuntime } from '../projects/runtime';
import { projectFolderName } from '../projects/service';
import type { MediaService } from '../media/service';
import { runCommand, type RunCommand } from '../process/run';
import { activeItems, compileRender, ProgressParser, unsupportedItems, type RenderSource } from './compiler';
import { exportPresets } from './presets';
import type { OverlayItem } from './overlays';
import { z } from 'zod/v3';

export async function claimVersion(root: string, name: string, extension: string) {
  const stem = projectFolderName(name); await mkdir(await managedPath(root, 'final'), { recursive: true });
  for (let version = 1; version < 1_000_000; version++) {
    const rel = `final/${stem}_v${String(version).padStart(3, '0')}.${extension}`; const file = await managedPath(root, rel);
    try {
      const handle = await open(file, 'wx', 0o600); const identity = await handle.stat(); await handle.close();
      const owns = async (): Promise<boolean> => { const current = await lstat(file).catch(() => null); return !!current?.isFile() && current.dev === identity.dev && current.ino === identity.ino; };
      return { rel, file, remove: async () => { if (await owns()) await rm(file); }, publish: async (temporary: string) => {
        if (!await owns()) throw new IpcFailure({ code: 'conflict', message: 'The reserved export filename changed. Export again to a new version.' });
        await rm(file);
        // Hard-link publication is atomic and exclusive: unlike rename, it can never replace a new user file.
        await link(temporary, file); await rm(temporary);
      } };
    } catch (error) { if (error instanceof Error && 'code' in error && error.code === 'EEXIST') continue; throw error; }
  }
  throw new IpcFailure({ code: 'conflict', message: 'No unused export version is available.' });
}
export class ExportService {
  constructor(private readonly runtime: WorkflowRuntime, private readonly media: MediaService, private readonly resolveTool: (name: string) => Promise<string>, private readonly run: RunCommand = runCommand) {}
  private preset(id: string) { const preset = exportPresets(this.runtime.settings.get()).find((preset) => preset.id === id); if (!preset) throw new IpcFailure({ code: 'not_found', message: 'Render preset not found.' }); return preset; }
  async preflight(request: InvokeReq<'export.preflight'>): Promise<ExportPreflight> {
    const session = this.runtime.projects.require(); const doc = this.runtime.timeline().state().doc; const preset = this.preset(request.presetId); const blockers: string[] = [];
    if (!activeItems(doc).length) blockers.push('Add media or other items to the timeline first.');
    const size = preset.size === 'project' ? doc.format : preset.size; if (size.width % 2 || size.height % 2) blockers.push('Export dimensions must be even.');
    for (const tool of ['ffmpeg', 'ffprobe']) { try { await this.resolveTool(tool); } catch { blockers.push(`Install or repair ${tool} in Settings → Tools.`); } }
    for (const rel of new Set(activeItems(doc).flatMap(({ item }) => item.type === 'clip' || item.type === 'audio' ? [item.src] : []))) {
      try { const file = await resolveInProject(session.rootPath, rel); if (!(await lstat(file)).isFile()) throw new Error('Not a file'); }
      catch { blockers.push(`Source media is missing or inaccessible: ${rel}`); }
    }
    const unsupported = unsupportedItems(doc);
    for (const { item } of activeItems(doc)) if (item.type === 'text' || item.type === 'caption' || item.type === 'composition') {
      const reason = await this.runtime.overlays.available(item);
      if (reason && !unsupported.some((entry) => entry.itemId === item.id)) unsupported.push({ itemId: item.id, type: item.type, name: `${item.type === 'composition' ? item.path : item.type === 'text' ? item.text.slice(0, 80) : 'Captions'} — ${reason}` });
    }
    return { canExport: blockers.length === 0, blockers, unsupportedItems: unsupported, outputLabel: `final/${projectFolderName(session.project.name)}_vNNN.${preset.container}` };
  }
  async start(request: InvokeReq<'export.start'>): Promise<{ jobId: string }> {
    const session = this.runtime.projects.require(); const timeline = this.runtime.timeline(); const state = timeline.state(); const preset = this.preset(request.presetId); const preflight = await this.preflight(request);
    if (!preflight.canExport) throw new IpcFailure({ code: 'unavailable', message: preflight.blockers.join(' ') });
    if (preflight.unsupportedItems.length && !request.acknowledgeUnsupported) throw new IpcFailure({ code: 'invalid_request', message: 'This export contains unsupported overlays or effects. Acknowledge their omission before exporting.', details: { unsupportedItems: preflight.unsupportedItems } });
    const sources: Record<string, RenderSource> = {};
    for (const rel of new Set(activeItems(state.doc).flatMap(({ item }) => item.type === 'clip' || item.type === 'audio' ? [item.src] : []))) sources[rel] = { path: await resolveInProject(session.rootPath, rel), hasAudio: !!(await this.media.probeFile(rel)).acodec };
    if (this.runtime.projects.current()?.project.id !== session.project.id || timeline.state().revision !== state.revision) throw new IpcFailure({ code: 'conflict', message: 'The project or timeline changed during preparation. Try exporting again.' });
    if (this.runtime.settings.get().snapshots.autoBeforeExport) await timeline.createSnapshot('Before export');
    const binary = await this.resolveTool('ffmpeg');
    return this.runtime.jobs.enqueue(session, 'export', `Export · ${preset.name}`, async (context) => {
      let directory: string | undefined; let claim: Awaited<ReturnType<typeof claimVersion>> | undefined;
      try {
        if (context.signal.aborted) throw new Error('Cancelled');
        claim = await claimVersion(session.rootPath, session.project.name, preset.container);
        const base = await managedPath(session.rootPath, 'work/exports'); await mkdir(base, { recursive: true }); directory = await mkdtemp(path.join(base, 'export-'));
        const overlays: Record<string, { path: string }> = {}; let reused = 0; let updated = 0;
        const omitted = new Set(preflight.unsupportedItems.map((item) => item.itemId));
        const items = activeItems(state.doc).filter(({ item }) => !omitted.has(item.id) && (item.type === 'composition' || item.type === 'text' || item.type === 'caption') && (!request.range || item.start < request.range.end && item.start + item.duration > request.range.start));
        const size = preset.size === 'project' ? state.doc.format : preset.size;
        for (const { item } of items) {
          context.progress(0.05 + (updated + reused) / Math.max(1, items.length) * 0.35, `Preparing compositions · ${reused} reused; ${updated} updated`);
          const result = await this.runtime.overlays.render(session.rootPath, item as OverlayItem, { ...state.doc.format, ...size, fps: preset.fps === 'project' ? state.doc.format.fps : preset.fps }, { ...context, progress: () => {} }); overlays[item.id] = { path: result.path }; if (result.reused) reused++; else updated++;
          context.progress(0.05 + (updated + reused) / Math.max(1, items.length) * 0.35, `Preparing compositions · ${reused} reused; ${updated} updated`);
        }
        const temporary = path.join(directory, `render.${preset.container}`); const plan = compileRender(state.doc, preset, sources, temporary, request.range, overlays);
        context.log(`Overlays: ${reused} reused; ${updated} updated\n`);
        const progress = new ProgressParser(plan.duration, (value, phase) => context.progress(0.4 + value * 0.55, phase));
        const result = await this.run(binary, plan.args, { signal: context.signal, timeoutMs: 24 * 60 * 60_000, cwd: session.rootPath, onStdout: (chunk) => progress.push(chunk), onStderr: (chunk) => context.log(chunk) });
        if (result.code !== 0) throw new IpcFailure({ code: 'invalid_request', message: 'FFmpeg could not encode this export. Open the job log for details.' });
        if (context.signal.aborted) throw new Error('Cancelled');
        const metadata = await lstat(temporary); if (!metadata.isFile() || !metadata.size) throw new IpcFailure({ code: 'internal', message: 'FFmpeg produced no video.' });
        context.progress(0.96, 'Verifying output');
        const probe = await this.run(await this.resolveTool('ffprobe'), ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', temporary], { signal: context.signal, timeoutMs: 30_000 });
        const checked = z.object({ format: z.object({ duration: z.coerce.number().finite().positive() }), streams: z.array(z.object({ codec_type: z.string(), width: z.number().optional(), height: z.number().optional() }).passthrough()) }).parse(JSON.parse(probe.stdout));
        if (probe.code !== 0 || !checked.streams.some((stream) => stream.codec_type === 'video' && stream.width === plan.width && stream.height === plan.height) || Math.abs(checked.format.duration - plan.duration) > Math.max(0.1, 2 / plan.fps)) throw new IpcFailure({ code: 'unavailable', message: 'The export failed output verification. No final file was published.' });
        context.signal.throwIfAborted(); await claim.publish(temporary); this.media.notify([claim.rel]); return { rel: claim.rel, durationSec: plan.duration, width: plan.width, height: plan.height, fps: plan.fps };
      } finally { await claim?.remove(); if (directory) await rm(directory, { recursive: true, force: true }); }
    });
  }
}
