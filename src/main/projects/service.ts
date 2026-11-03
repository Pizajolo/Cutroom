import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, link, lstat, mkdir, mkdtemp, open, readdir, realpath, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod/v3';
import { IpcFailure } from '@shared/ipc/errors';
import type { InvokeReq, InvokeRes } from '@shared/ipc/contract';
import { FOLDER_GRANT_TTL_MS, projectDocSchema, projectSessionSchema, recentProjectSchema, type ProjectCreateResult, type ProjectSession } from '@shared/schema/project';
import { timelineDocSchema, TRACK_KINDS } from '@shared/schema/timeline';
import { PROJECT_DIRS } from '@shared/project/constants';
import { atomicJson, isMissing, managedPath, readManaged } from '../fs/managed';
import { importName } from '../media/import';
import { resolveInProject } from '../fs/safePath';
import { mediaKind, type MediaService } from '../media/service';
import { FolderGrants } from './grants';

type Creation = Pick<InvokeReq<'project.create'>, 'name' | 'format' | 'defaultEngine'>;
interface FootageImport { projectId: string; root: string; footage: string; sources: string[]; next: number }
interface ImportRetry { state: FootageImport; expiresAt: number }
export function emptyTimeline(format: Creation['format']) {
  return timelineDocSchema.parse({ version: 1, format, tracks: TRACK_KINDS.map((kind) => ({ id: kind, kind, name: kind, muted: false, solo: false, items: [] })), markers: [] });
}
export function projectFolderName(name: string): string { return importName(name).replace(/^\.+/, '').trim() || 'Untitled'; }
export class ProjectService {
  readonly grants: FolderGrants;
  private session: ProjectSession | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<(session: ProjectSession | null) => void | Promise<void>>();
  private readonly importRetries = new Map<string, ImportRetry>();
  constructor(private readonly options: { home: string; media: MediaService; grants?: FolderGrants; copyFootage?: typeof copyFile; now?: () => number; onChanged?: (session: ProjectSession | null) => void; onProgress?: (projectId: string, completed: number, total: number, rel: string) => void }) { this.grants = options.grants ?? new FolderGrants(); }
  onChanged(listener: (session: ProjectSession | null) => void | Promise<void>): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  current(): ProjectSession | null { return this.session ? structuredClone(this.session) : null; }
  require(): ProjectSession { if (!this.session) throw new IpcFailure({ code: 'not_found', message: 'Open or create a project first.' }); return structuredClone(this.session); }
  private exclusive<T>(action: () => Promise<T>): Promise<T> { const pending = this.queue.then(action); this.queue = pending.catch(() => undefined); return pending; }
  private async recent() { await mkdir(this.options.home, { recursive: true, mode: 0o700 }); try { return z.array(recentProjectSchema.omit({ missing: true })).max(100).parse(JSON.parse(await readManaged(this.options.home, 'recent-projects.json'))); } catch (error) { if (isMissing(error)) return []; throw new IpcFailure({ code: 'invalid_request', message: 'The recent projects file is invalid.' }); } }
  async listRecent(): Promise<InvokeRes<'project.listRecent'>> { return Promise.all((await this.recent()).map(async (entry) => ({ ...entry, missing: !(await stat(path.join(entry.rootPath, '.cutroom/project.json')).catch(() => null))?.isFile() }))); }
  removeRecent(id: string): Promise<{ ok: true }> { return this.exclusive(async () => { await atomicJson(this.options.home, 'recent-projects.json', (await this.recent()).filter((entry) => entry.id !== id)); return { ok: true }; }); }
  private async activate(session: ProjectSession): Promise<ProjectSession> {
    const validated = projectSessionSchema.parse(session);
    const recent = await this.recent();
    await atomicJson(this.options.home, 'recent-projects.json', [{ id: session.project.id, name: session.project.name, rootPath: session.rootPath, format: session.project.format, lastOpenedAt: new Date().toISOString() }, ...recent.filter((entry) => entry.id !== session.project.id)].slice(0, 100));
    // Finish fallible metadata writes before changing the active timeline or media root.
    for (const listener of this.listeners) await listener(validated);
    await this.options.media.bindProject(session.project.id, session.rootPath);
    this.session = validated;
    this.options.onChanged?.(this.current()); return this.require();
  }
  private async loose(root: string): Promise<string[]> { return (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isFile() && !entry.name.startsWith('.') && mediaKind(entry.name) !== 'other').map((entry) => entry.name); }
  private async readProject(root: string): Promise<ProjectSession> {
    const canonical = await realpath(root).catch(() => { throw new IpcFailure({ code: 'not_found', message: 'The project folder no longer exists.' }); });
    const project = projectDocSchema.parse(JSON.parse(await readManaged(canonical, '.cutroom/project.json')));
    timelineDocSchema.parse(JSON.parse(await readManaged(canonical, 'timeline.json')));
    return { project, rootPath: canonical, looseMediaCount: (await this.loose(canonical)).length };
  }
  open(request: InvokeReq<'project.open'>): Promise<InvokeRes<'project.open'>> {
    return this.exclusive(async () => {
      const recent = 'recentId' in request ? (await this.recent()).find((entry) => entry.id === request.recentId) : undefined;
      if ('recentId' in request && !recent) throw new IpcFailure({ code: 'not_found', message: 'This recent project is not available.' });
      const root = recent?.rootPath ?? this.grants.consume('grantId' in request ? request.grantId : '', 'openProject');
      try { await readManaged(root, '.cutroom/project.json'); }
      catch (error) {
        if (!isMissing(error)) throw error;
        if (recent) throw new IpcFailure({ code: 'not_found', message: 'The project folder or project metadata no longer exists.' });
        const grant = await this.grants.issue(root, 'openProject');
        return { status: 'needsCreate', ...grant, looseMediaCount: (await this.loose(root)).length };
      }
      return { status: 'opened', session: await this.activate(await this.readProject(root)) };
    });
  }
  private async initialize(root: string, request: Creation): Promise<ProjectSession> {
    // Preflight every existing path before making the first mutation. Never adopt a partial/foreign project.
    for (const rel of ['.cutroom', ...PROJECT_DIRS, 'timeline.json']) {
      const file = await managedPath(root, rel);
      const info = await lstat(file).catch((error) => { if (isMissing(error)) return null; throw error; });
      if (info && (rel === 'timeline.json' || !info.isDirectory())) throw new IpcFailure({ code: 'conflict', message: `Cannot initialize this folder: ${rel} already exists or is not a directory.` });
      if (rel === '.cutroom' && info) throw new IpcFailure({ code: 'conflict', message: 'This folder already contains Cutroom metadata.' });
    }
    await mkdir(await managedPath(root, '.cutroom'), { mode: 0o700 });
    for (const directory of PROJECT_DIRS) await mkdir(await managedPath(root, directory), { recursive: true });
    const project = projectDocSchema.parse({ id: randomUUID(), name: request.name, format: request.format, defaultEngine: request.defaultEngine, folderMap: Object.fromEntries(PROJECT_DIRS.map((directory) => [directory, directory])), createdAt: new Date().toISOString() });
    for (const [rel, value] of [['timeline.json', emptyTimeline(request.format)], ['.cutroom/project.json', project]] as const) {
      const file = await open(await managedPath(root, rel), 'wx', 0o600);
      try { await file.writeFile(`${JSON.stringify(value, null, 2)}\n`); await file.sync(); } finally { await file.close(); }
    }
    return { project, rootPath: root, looseMediaCount: (await this.loose(root)).length };
  }
  createInPlace(request: InvokeReq<'project.createInPlace'>): Promise<ProjectSession> { return this.exclusive(async () => this.activate(await this.initialize(this.grants.consume(request.grantId, 'openProject'), request))); }
  private async copyRemaining(state: FootageImport): Promise<ProjectCreateResult> {
    const session = this.require();
    const published: string[] = [];
    try {
      while (state.next < state.sources.length) {
        const source = await resolveInProject(state.footage, path.relative(state.footage, state.sources[state.next]!));
        const parsed = path.parse(importName(source));
        const directory = await mkdtemp(path.join(await managedPath(state.root, 'work'), 'footage-'));
        let imported = '';
        try {
          const temporary = path.join(directory, 'copy');
          await (this.options.copyFootage ?? copyFile)(source, temporary, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE);
          for (let suffix = 1; ; suffix++) {
            const rel = `raw/${parsed.name}${suffix === 1 ? '' : `-${suffix}`}${parsed.ext}`;
            try { await link(temporary, await managedPath(state.root, rel)); imported = rel; break; }
            catch (error) { if (error instanceof Error && 'code' in error && error.code === 'EEXIST') continue; throw error; }
          }
          state.next++; published.push(imported);
        } finally { await rm(directory, { recursive: true, force: true }); }
        this.options.onProgress?.(session.project.id, state.next, state.sources.length, imported);
      }
      return session;
    } catch {
      // The project already exists and is registered. Preserve its identity and
      // successful imports; a retry continues at the first unpublished source.
      const now = this.options.now?.() ?? Date.now();
      for (const [id, retry] of this.importRetries) if (retry.expiresAt <= now) this.importRetries.delete(id);
      if (this.importRetries.size >= 100) this.importRetries.delete(this.importRetries.keys().next().value!);
      const retryId = randomUUID(); this.importRetries.set(retryId, { state, expiresAt: now + FOLDER_GRANT_TTL_MS });
      return { ...session, importWarning: { message: 'Project created, but some footage could not be copied. Check source access and disk space, then retry the remaining import in this project.', completed: state.next, total: state.sources.length, retryId } };
    } finally { if (published.length) this.options.media.notify(published); }
  }
  retryFootageImport(retryId: string): Promise<ProjectCreateResult> {
    return this.exclusive(async () => {
      const retry = this.importRetries.get(retryId);
      if (!retry || retry.expiresAt <= (this.options.now?.() ?? Date.now())) { this.importRetries.delete(retryId); throw new IpcFailure({ code: 'forbidden', message: 'This import retry has expired or was already used. Open the created project and import the remaining footage again.' }); }
      const session = this.require();
      if (session.project.id !== retry.state.projectId || session.rootPath !== retry.state.root) throw new IpcFailure({ code: 'conflict', message: 'Open the originally created project before retrying its footage import.' });
      this.importRetries.delete(retryId);
      return this.copyRemaining(retry.state);
    });
  }
  create(request: InvokeReq<'project.create'>): Promise<ProjectCreateResult> {
    return this.exclusive(async () => {
      const parent = this.grants.consume(request.parentGrant, 'projectParent');
      const footage = request.footageGrant ? this.grants.consume(request.footageGrant, 'footage') : undefined;
      const sources: string[] = [];
      const walk = async (folder: string, depth = 0): Promise<void> => {
        if (depth > 16 || sources.length > 10000) throw new IpcFailure({ code: 'invalid_request', message: 'The footage folder is too large.' });
        for (const entry of (await readdir(folder, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
          if (entry.name.startsWith('.')) continue;
          if (entry.isDirectory()) await walk(path.join(folder, entry.name), depth + 1);
          else if (entry.isFile() && mediaKind(entry.name) !== 'other') sources.push(path.join(folder, entry.name));
        }
      };
      if (footage) await walk(footage);
      const base = projectFolderName(request.name); let root = '';
      for (let suffix = 1; ; suffix++) {
        root = path.join(parent, suffix === 1 ? base : `${base}-${suffix}`);
        try { await mkdir(root); break; } catch (error) { if (error instanceof Error && 'code' in error && error.code === 'EEXIST') continue; throw error; }
      }
      const session = await this.activate(await this.initialize(root, request));
      return footage && sources.length ? this.copyRemaining({ projectId: session.project.id, root: session.rootPath, footage, sources, next: 0 }) : session;
    });
  }
  adoptLooseMedia(rels: string[]) { return this.exclusive(async () => {
    const session = this.require();
    for (const rel of rels) if (rel.includes('/') || mediaKind(rel) === 'other') throw new IpcFailure({ code: 'forbidden', message: 'Only top-level loose media can be adopted.' });
    const files = await this.options.media.adoptLooseMedia(rels);
    this.session = { ...session, looseMediaCount: (await this.loose(session.rootPath)).length }; return files;
  }); }
  close(): Promise<{ ok: true }> { return this.exclusive(async () => { for (const listener of this.listeners) await listener(null); this.options.media.close(); this.session = null; this.options.onChanged?.(null); return { ok: true }; }); }
}
