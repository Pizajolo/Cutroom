import { constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, readFile, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod/v3';
import { IpcFailure } from '@shared/ipc/errors';
import { whisperModelNameSchema, type WhisperModelInfo, type WhisperModelName } from '@shared/schema/models';
import type { InstallState } from '@shared/schema/media';
import { SettingsStore } from '../settings/store';
import type { ModelPin } from '../tools/manifest';
import { download, DownloadFailure, type Fetch } from '../tools/download';
import { atomicJson, isMissing, managedDirectory, publishExclusive } from '../tools/files';
import { createHash } from 'node:crypto';

const statSchema = z.object({ size: z.number(), mtimeMs: z.number(), ctimeMs: z.number(), ino: z.number(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const cacheSchema = z.record(statSchema);
export class WhisperModels {
  private cache: z.infer<typeof cacheSchema> = {};
  private readonly installs = new Map<string, InstallState>();
  private readonly jobs = new Map<string, { controller: AbortController; done: Promise<void> }>();
  private readonly deleting = new Set<string>();
  private infos: WhisperModelInfo[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private lastEmitted = 0;
  private closed = false;
  constructor(private readonly options: { home: string; pins: ModelPin[]; settings: SettingsStore; fetch?: Fetch; onChanged?: (models: WhisperModelInfo[]) => void }) {}
  private pin(name: string): ModelPin {
    const parsed = whisperModelNameSchema.safeParse(name); const pin = parsed.success && this.options.pins.find((pin) => pin.name === parsed.data);
    if (!pin) throw new IpcFailure({ code: 'invalid_request', message: 'Unknown Whisper model.' }); return pin;
  }
  async initialize(): Promise<void> {
    try { this.cache = cacheSchema.parse(JSON.parse(await readFile(path.join(this.options.home, 'models-cache.json'), 'utf8'))); } catch { /* Untrusted cache is ignored. */ }
    await this.list();
  }
  private async status(pin: ModelPin): Promise<WhisperModelInfo['status']> {
    const file = path.join(this.options.home, 'models', `ggml-${pin.name}.bin`);
    try {
      const home = await realpath(this.options.home); if (await realpath(path.dirname(file)) !== path.join(home, 'models')) return 'checksum_mismatch';
      const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const before = await handle.stat(); if (!before.isFile() || before.size !== pin.sizeBytes) return 'checksum_mismatch';
        const old = this.cache[pin.name];
        if (old?.size === before.size && old.ino === before.ino && old.mtimeMs === before.mtimeMs && old.ctimeMs === before.ctimeMs && old.sha256 === pin.sha256) return 'installed';
        const hash = createHash('sha256'); for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
        const after = await handle.stat();
        if (hash.digest('hex') !== pin.sha256 || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) { delete this.cache[pin.name]; return 'checksum_mismatch'; }
        this.cache[pin.name] = { size: before.size, mtimeMs: before.mtimeMs, ctimeMs: before.ctimeMs, ino: before.ino, sha256: pin.sha256 }; return 'installed';
      } finally { await handle.close(); }
    } catch (error) { return isMissing(error) ? 'missing' : 'checksum_mismatch'; }
  }
  async list(): Promise<WhisperModelInfo[]> {
    const selected = this.options.settings.get().whisperModel;
    const models = await Promise.all(this.options.pins.map(async (pin): Promise<WhisperModelInfo> => ({ name: pin.name, sizeBytes: pin.sizeBytes, status: await this.status(pin), install: this.installs.get(pin.name) ?? null, isDefault: selected === pin.name })));
    const changed = JSON.stringify(this.infos) !== JSON.stringify(models); this.infos = models;
    const home = await managedDirectory(this.options.home); await atomicJson(path.join(home, 'models-cache.json'), this.cache);
    if (changed) this.emit(); return structuredClone(models);
  }
  private emit(): void {
    if (this.timer || this.closed) return;
    const send = (): void => { this.timer = undefined; this.lastEmitted = Date.now(); this.options.onChanged?.(structuredClone(this.infos)); };
    const wait = Math.max(0, 250 - (Date.now() - this.lastEmitted));
    if (!wait) send(); else { this.timer = setTimeout(send, wait); this.timer.unref(); }
  }
  private state(name: string, state: InstallState | null): void {
    if (state) this.installs.set(name, state); else this.installs.delete(name);
    this.infos = this.infos.map((info) => info.name === name ? { ...info, install: state } : info); this.emit();
  }
  async ensureDefault(): Promise<void> {
    if (this.closed) return;
    const settings = this.options.settings.get(); const name = settings.whisperModel;
    if (settings.whisperAutoDownloadSuppressed.includes(name) || this.deleting.has(name)) return;
    const model = (await this.list()).find((model) => model.name === name);
    if (model?.status === 'missing' && !this.options.settings.get().whisperAutoDownloadSuppressed.includes(name)) await this.download(name).catch(() => undefined);
  }
  private async allowAutomaticDownload(name: WhisperModelName): Promise<void> {
    if (this.options.settings.get().whisperAutoDownloadSuppressed.includes(name)) await this.options.settings.update((draft) => { draft.whisperAutoDownloadSuppressed = draft.whisperAutoDownloadSuppressed.filter((model) => model !== name); });
  }
  download(name: string): Promise<void> {
    const pin = this.pin(name); if (this.closed) return Promise.reject(new IpcFailure({ code: 'unavailable', message: 'The app is shutting down.' }));
    if (this.deleting.has(name)) return Promise.reject(new IpcFailure({ code: 'unavailable', message: 'This model is being deleted. Wait and retry the download.' }));
    const old = this.jobs.get(name); if (old) return old.done;
    const controller = new AbortController(); const signal = controller.signal;
    this.state(name, { state: 'queued', received: 0, total: pin.sizeBytes });
    const done = (async () => {
      let staging: string | undefined;
      try {
        if (await this.status(pin) === 'installed') { await this.allowAutomaticDownload(pin.name); return; }
        const root = await managedDirectory(this.options.home, 'models'); staging = await mkdtemp(path.join(root, '.staging-'));
        const downloads = path.join(staging, 'downloads'); await mkdir(downloads);
        const file = path.join(downloads, 'model.bin');
        const result = await download({ url: pin.url, file, policy: pin, limit: pin.sizeBytes, fetch: this.options.fetch, signal,
          onProgress: (received) => this.state(name, { state: 'downloading', received, total: pin.sizeBytes }) });
        this.state(name, { state: 'verifying', received: result.size, total: pin.sizeBytes });
        if (result.size !== pin.sizeBytes || result.sha256 !== pin.sha256) throw new DownloadFailure('The model checksum or size does not match. Nothing was installed.');
        signal.throwIfAborted(); this.state(name, { state: 'installing', received: result.size, total: pin.sizeBytes });
        const target = path.join(root, `ggml-${pin.name}.bin`);
        await publishExclusive(file, target, pin.sha256);
        const installed = await lstat(target);
        this.cache[pin.name] = { size: installed.size, mtimeMs: installed.mtimeMs, ctimeMs: installed.ctimeMs, ino: installed.ino, sha256: pin.sha256 };
        await this.allowAutomaticDownload(pin.name);
      } catch (error) {
        if (!signal.aborted) this.state(name, { state: 'failed', received: 0, total: pin.sizeBytes, error: error instanceof DownloadFailure ? error.message : 'Could not save the model. Check disk space and permissions; existing files are never overwritten.' });
        throw new IpcFailure({ code: 'unavailable', message: signal.aborted ? 'Model download cancelled.' : error instanceof DownloadFailure ? error.message : 'Model download failed. Check disk space and permissions.' });
      } finally {
        if (staging) await rm(staging, { recursive: true, force: true });
        if (signal.aborted || this.installs.get(name)?.state !== 'failed') this.state(name, null);
        this.jobs.delete(name); await this.list();
      }
    })();
    this.jobs.set(name, { controller, done }); return done;
  }
  async cancel(name: string): Promise<void> { this.pin(name); const job = this.jobs.get(name); if (job) { job.controller.abort(); await job.done.catch(() => undefined); } }
  async delete(name: string): Promise<void> {
    const pin = this.pin(name);
    if (this.deleting.has(name)) throw new IpcFailure({ code: 'unavailable', message: 'This model is already being deleted.' });
    this.deleting.add(name);
    try {
      await this.cancel(name);
      const root = await managedDirectory(this.options.home, 'models'); const target = path.join(root, `ggml-${pin.name}.bin`);
      let exists = true;
      try { if (!(await lstat(target)).isFile() || await realpath(target) !== target) throw new Error('Not a regular model file.'); }
      catch (error) { if (isMissing(error)) exists = false; else throw new IpcFailure({ code: 'forbidden', message: 'The model path is not an ordinary managed file.' }); }
      // Persist opt-out before removing bytes, so a crash cannot undo deliberate deletion.
      await this.options.settings.update((draft) => { if (!draft.whisperAutoDownloadSuppressed.includes(pin.name)) draft.whisperAutoDownloadSuppressed.push(pin.name); });
      try { if (exists) await rm(target); }
      catch (error) { if (!isMissing(error)) throw new IpcFailure({ code: 'forbidden', message: 'The model file could not be deleted. Check its permissions.' }); }
      delete this.cache[name]; this.state(name, null); await this.list();
    } finally { this.deleting.delete(name); }
  }
  async setDefault(name: string): Promise<WhisperModelInfo[]> { const pin = this.pin(name); await this.options.settings.update((draft) => { draft.whisperModel = pin.name as WhisperModelName; }); return this.list(); }
  async close(): Promise<void> { this.closed = true; if (this.timer) clearTimeout(this.timer); for (const job of this.jobs.values()) job.controller.abort(); await Promise.all([...this.jobs.values()].map((job) => job.done.catch(() => undefined))); }
}
