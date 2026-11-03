import { createHash } from 'node:crypto';
import { watch, type FSWatcher } from 'node:fs';
import { projectPathSchema } from '../../shared/schema/common';
import { readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { IpcFailure } from '../../shared/ipc/contract';
import type { ImportDestination, MediaFile, Thumbnails, Waveform } from '../../shared/schema/media';
import { resolveInProject } from '../fs/safePath';
import { ToolUnavailable } from '../tools/registry';
import type { MediaContext } from './cache';
import { importPaths } from './import';
import { probe } from './probe';
import { mediaFailure, type ToolResolver } from './process';
import { thumbnails } from './thumbnails';
import { waveform } from './waveform';

export interface MediaProgress { projectId: string; rel: string; stage: 'probe' | 'thumbnails' | 'waveform' | 'import'; progress: number }
interface CurrentFolder { id: string; root: string; controller: AbortController }
export interface MediaServiceOptions {
  resolveTool: ToolResolver;
  url: (projectId: string, rel: string) => string;
  onChanged?: (projectId: string, rels: string[]) => void;
  onProgress?: (progress: MediaProgress) => void;
}
const image = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.tif', '.tiff', '.bmp']);
const audio = new Set(['.wav', '.mp3', '.m4a', '.aac', '.ogg', '.flac', '.aiff', '.aif']);
const video = new Set(['.mp4', '.mov', '.m4v', '.mkv', '.webm', '.avi']);
export function mediaKind(rel: string): MediaFile['kind'] { const ext = path.extname(rel).toLowerCase(); return image.has(ext) ? 'image' : audio.has(ext) ? 'audio' : video.has(ext) ? 'video' : 'other'; }
export class MediaService {
  private current: CurrentFolder | undefined;
  private watcher: FSWatcher | undefined;
  private watchTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly changedPaths = new Set<string>();
  constructor(private readonly options: MediaServiceOptions) {}
  async selectFolder(root: string): Promise<{ id: string; root: string }> {
    return this.bindProject(createHash('sha256').update(await realpath(root)).digest('hex').slice(0, 24), root);
  }
  async bindProject(id: string, root: string): Promise<{ id: string; root: string }> {
    const canonical = await realpath(root);
    if (!(await stat(canonical)).isDirectory()) throw mediaFailure('invalid_request', 'Select a project folder.', 'invalid_folder');
    const watcher = watch(canonical, { recursive: true }, (_event, filename) => {
      if (this.current?.id !== id) return;
      if (filename && filename.includes('/') && !['raw', 'references', 'assets', 'audio', 'final'].includes(filename.split('/')[0] ?? '')) return;
      if (filename && projectPathSchema.safeParse(filename).success) this.changedPaths.add(filename);
      if (this.watchTimer) return;
      this.watchTimer = setTimeout(() => {
        this.watchTimer = undefined;
        if (this.current?.id === id) this.options.onChanged?.(id, [...this.changedPaths]);
        this.changedPaths.clear();
      }, 200);
      this.watchTimer.unref();
    });
    watcher.on('error', () => { watcher.close(); if (this.current?.id === id) this.options.onChanged?.(id, []); });
    this.close();
    this.current = { id, root: canonical, controller: new AbortController() };
    this.watcher = watcher;
    this.options.onChanged?.(this.current.id, []);
    return { id: this.current.id, root: canonical };
  }
  currentId(): string { return this.requireFolder().id; }
  rootFor(id: string): string | undefined { return this.current?.id === id ? this.current.root : undefined; }
  private requireFolder(): CurrentFolder { if (!this.current) throw mediaFailure('not_found', 'Browse an existing project folder first.', 'no_project'); return this.current; }
  private context(folder: CurrentFolder, rel: string, stage: MediaProgress['stage']): MediaContext {
    return {
      root: folder.root, resolveTool: this.options.resolveTool, url: (file) => this.options.url(folder.id, file), signal: folder.controller.signal,
      onProgress: (fraction) => this.options.onProgress?.({ projectId: folder.id, rel, stage, progress: Math.min(1, Math.max(0, fraction)) }),
    };
  }
  private check(folder: CurrentFolder): void { if (folder !== this.current || folder.controller.signal.aborted) throw mediaFailure('invalid_request', 'Media operation cancelled.', 'cancelled'); }
  private async file(folder: CurrentFolder, rel: string): Promise<MediaFile> {
    this.check(folder);
    const section = rel.includes('/') ? rel.split('/')[0] as Exclude<MediaFile['section'], 'root'> : 'root';
    const result: MediaFile = { rel, name: path.basename(rel), kind: mediaKind(rel), url: this.options.url(folder.id, rel), probe: null, section };
    if (result.kind !== 'other') {
      try { result.probe = await probe(this.context(folder, rel, 'probe'), rel); }
      catch (error) {
        if (error instanceof ToolUnavailable) result.error = { code: error.status, message: error.message };
        else if (error instanceof IpcFailure) result.error = { code: String(error.details?.kind ?? error.code), message: error.message };
        else result.error = { code: 'invalid_media', message: 'This media file could not be read.' };
      }
    }
    this.check(folder);
    return result;
  }
  async list(): Promise<MediaFile[]> {
    const folder = this.requireFolder();
    const rels = (await readdir(folder.root, { withFileTypes: true })).filter((entry) => entry.isFile() && !entry.name.startsWith('.') && mediaKind(entry.name) !== 'other').map((entry) => entry.name);
    const walk = async (rel: string, depth: number): Promise<void> => {
      this.check(folder);
      if (depth > 16 || rels.length >= 10000) throw mediaFailure('invalid_request', 'This folder exceeds the media browsing limit.', 'browse_limit');
      const directory = await resolveInProject(folder.root, rel);
      let entries;
      try { entries = await readdir(directory, { withFileTypes: true }); }
      catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return; throw error; }
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const child = `${rel}/${entry.name}`;
        if (entry.isDirectory()) await walk(child, depth + 1);
        else if (entry.isFile()) { if (rels.length >= 10000) throw mediaFailure('invalid_request', 'Too many media files.', 'browse_limit'); rels.push(child); }
      }
    };
    for (const directory of ['raw', 'references', 'assets', 'audio', 'final']) await walk(directory, 0);
    const files: MediaFile[] = [];
    for (const rel of rels.sort()) files.push(await this.file(folder, rel));
    return files;
  }
  async import(paths: readonly string[], destination: ImportDestination): Promise<MediaFile[]> {
    const folder = this.requireFolder();
    const rels = await importPaths(folder.root, paths, destination, { signal: folder.controller.signal, onProgress: (completed, total) => this.options.onProgress?.({ projectId: folder.id, rel: destination, stage: 'import', progress: completed / total }) });
    this.check(folder); this.options.onChanged?.(folder.id, rels);
    const files: MediaFile[] = []; for (const rel of rels) files.push(await this.file(folder, rel));
    return files;
  }
  async adoptLooseMedia(rels: readonly string[]): Promise<MediaFile[]> {
    const folder = this.requireFolder(); const paths: string[] = [];
    for (const rel of rels) {
      if (rel.includes('/') || mediaKind(rel) === 'other') throw mediaFailure('forbidden', 'Only loose root media can be adopted.', 'invalid_import');
      paths.push(await resolveInProject(folder.root, rel));
    }
    const imported = await importPaths(folder.root, paths, 'raw', { firstSuffix: 2, signal: folder.controller.signal });
    this.check(folder); this.options.onChanged?.(folder.id, imported);
    return Promise.all(imported.map((rel) => this.file(folder, rel)));
  }
  async probeFile(rel: string) { const folder = this.requireFolder(); return probe(this.context(folder, rel, 'probe'), rel); }
  async sourceDurations(): Promise<Record<string, number>> { return Object.fromEntries((await this.list()).filter((file) => file.probe).map((file) => [file.rel, file.probe!.duration])); }
  notify(rels: string[]): void { const folder = this.requireFolder(); this.options.onChanged?.(folder.id, rels); }
  async thumbnails(rel: string): Promise<Thumbnails> { const folder = this.requireFolder(); const value = await thumbnails(this.context(folder, rel, 'thumbnails'), rel); this.check(folder); return value; }
  async waveform(rel: string): Promise<Waveform> { const folder = this.requireFolder(); const value = await waveform(this.context(folder, rel, 'waveform'), rel); this.check(folder); return value; }
  async revealPath(rel: string): Promise<string> { const folder = this.requireFolder(); const file = await resolveInProject(folder.root, rel); await stat(file); return file; }
  cancel(): void {
    const current = this.current; if (!current) return;
    current.controller.abort(); this.current = { ...current, controller: new AbortController() };
  }
  close(): void {
    this.current?.controller.abort(); this.current = undefined;
    this.watcher?.close(); this.watcher = undefined;
    if (this.watchTimer) clearTimeout(this.watchTimer); this.watchTimer = undefined; this.changedPaths.clear();
  }
}
