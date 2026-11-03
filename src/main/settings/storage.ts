import { randomUUID } from 'node:crypto';
import { lstat, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod/v3';
import { IpcFailure } from '@shared/ipc/errors';
import { storageCategorySchema } from '@shared/schema/editor';
import type { ProjectSession } from '@shared/schema/project';
import { isMissing, managedPath } from '../fs/managed';

type Category = z.infer<typeof storageCategorySchema>;
interface Entry { root: string; rel: string; category: Category; bytes: number; ino: number; dev: number; mtimeMs: number; ctimeMs: number; cleanable: boolean }
interface Capability { expires: number; projectId: string | null; entries: Entry[] }
const cleanable = new Set<Category>(['thumbnails', 'waveforms', 'renders', 'transcripts', 'snapshots', 'logs']);
export class StorageService {
  private readonly tokens = new Map<string, Capability>();
  constructor(private readonly options: { home: string; current: () => ProjectSession | null; newestSnapshot: () => Promise<string | undefined>; busy: () => boolean; now?: () => number }) {}
  private now(): number { return this.options.now?.() ?? Date.now(); }
  private async entries(): Promise<Entry[]> {
    const entries: Entry[] = []; const project = this.options.current(); const newest = project ? await this.options.newestSnapshot() : undefined;
    const walk = async (root: string, rel: string, category: Category, depth = 0): Promise<void> => {
      if (depth > 24 || entries.length > 100_000) throw new IpcFailure({ code: 'invalid_request', message: 'The storage tree is too large to inspect safely.' });
      const file = await managedPath(root, rel); const info = await lstat(file).catch((error) => { if (isMissing(error)) return null; throw error; });
      if (!info || info.isSymbolicLink()) return;
      if (info.isDirectory()) { for (const child of await readdir(file, { withFileTypes: true })) if (!child.isSymbolicLink()) await walk(root, `${rel}/${child.name}`, category, depth + 1); }
      else if (info.isFile()) {
        let actual = category;
        if (rel.startsWith('work/.cutroom-media/')) actual = /\.waveform\.json$/.test(rel) ? 'waveforms' : /\.(jpg|png|webp)$/.test(rel) ? 'thumbnails' : /\.probe\.json$/.test(rel) ? 'thumbnails' : category;
        const protectedSnapshot = !!newest && rel.startsWith(`.cutroom/snapshots/${newest}/`);
        entries.push({ root, rel, category: actual, bytes: info.size, ino: info.ino, dev: info.dev, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs, cleanable: cleanable.has(actual) && !protectedSnapshot });
      }
    };
    await walk(this.options.home, 'tools', 'tools'); await walk(this.options.home, 'models', 'models');
    for (const [rel, category] of [['cache/voice', 'transcripts'], ['cache/transcripts', 'transcripts'], ['cache/renders', 'renders'], ['cache/thumbnails', 'thumbnails'], ['cache/waveforms', 'waveforms']] as const) await walk(this.options.home, rel, category);
    if (project) for (const [rel, category] of [['work/.cutroom-media', 'thumbnails'], ['work/renders', 'renders'], ['work/transcripts', 'transcripts'], ['work/logs', 'logs'], ['.cutroom/snapshots', 'snapshots'], ['final', 'final']] as const) await walk(project.rootPath, rel, category);
    return entries;
  }
  async usage() { const entries = await this.entries(); return { totalBytes: entries.reduce((total, entry) => total + entry.bytes, 0), categories: storageCategorySchema.options.map((category) => { const selected = entries.filter((entry) => entry.category === category); return { category, bytes: selected.reduce((total, entry) => total + entry.bytes, 0), items: selected.length }; }) }; }
  async preview(categories: readonly Category[]) {
    if (categories.some((category) => !cleanable.has(category))) throw new IpcFailure({ code: 'forbidden', message: 'Original media, exports, installed tools and models cannot be cleaned.' });
    if (this.options.busy()) throw new IpcFailure({ code: 'conflict', message: 'Wait for running jobs to finish before cleaning storage.' });
    for (const [id, token] of this.tokens) if (token.expires <= this.now()) this.tokens.delete(id);
    if (this.tokens.size >= 100) throw new IpcFailure({ code: 'conflict', message: 'Too many pending cleanup previews.' });
    const entries = (await this.entries()).filter((entry) => categories.includes(entry.category) && entry.cleanable); const token = randomUUID();
    this.tokens.set(token, { expires: this.now() + 5 * 60_000, projectId: this.options.current()?.project.id ?? null, entries });
    return { token, bytes: entries.reduce((total, entry) => total + entry.bytes, 0), items: entries.map((entry) => ({ rel: entry.rel, bytes: entry.bytes, category: entry.category })) };
  }
  async clean(token: string): Promise<{ ok: true }> {
    const capability = this.tokens.get(token); this.tokens.delete(token);
    if (!capability || capability.expires <= this.now()) throw new IpcFailure({ code: 'forbidden', message: 'This cleanup preview expired or was already used. Preview again.' });
    if (this.options.busy() || capability.projectId !== (this.options.current()?.project.id ?? null)) throw new IpcFailure({ code: 'conflict', message: 'The project or job state changed. Preview cleanup again.' });
    const newest = this.options.current() ? await this.options.newestSnapshot() : undefined;
    const validate = async (entry: Entry): Promise<string> => {
      if (!entry.cleanable || !cleanable.has(entry.category) || (newest && entry.rel.startsWith(`.cutroom/snapshots/${newest}/`))) throw new IpcFailure({ code: 'forbidden', message: 'A protected file cannot be removed.' });
      const file = await managedPath(entry.root, entry.rel); const info = await lstat(file).catch(() => null);
      if (!info?.isFile() || info.dev !== entry.dev || info.ino !== entry.ino || info.size !== entry.bytes || info.mtimeMs !== entry.mtimeMs || info.ctimeMs !== entry.ctimeMs) throw new IpcFailure({ code: 'conflict', message: 'A cleanup file changed after the preview. Cleanup stopped; preview the remaining items again.' });
      return file;
    };
    // Preflight all entries before the first unlink; new files are never part of this capability.
    const files = await Promise.all(capability.entries.map(validate));
    for (const [index, file] of files.entries()) { await validate(capability.entries[index]!); await unlink(path.resolve(file)); }
    return { ok: true };
  }
}
