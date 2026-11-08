import { chmod, copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod/v3';
import { IpcFailure } from '@shared/ipc/errors';
import { download, checksumFromText, DownloadFailure, type Fetch } from './download';
import { compareVersions, toolNameSchema, type ToolPin } from './manifest';
import { managedDirectory, publishExclusive, sha256 } from './files';
import { clearQuarantine, extractZip, verifyArchitecture } from './binary';
import { releasePin, ToolRegistry } from './registry';
import { runCommand, type RunCommand } from '../process/run';
import { BUILD_ENV, CLT_MESSAGE, ensureCmake, hasDeveloperTools } from './cmake';
import { compileWhisper, sourceIsPinned, SOURCE_PIN_MESSAGE } from './whisperBuild';

interface Job { controller: AbortController; done: Promise<void> }
export interface InstallerOptions { registry: ToolRegistry; fetch?: Fetch; extract?: typeof extractZip; clearQuarantine?: typeof clearQuarantine; run?: RunCommand }
export class ToolInstaller {
  private readonly jobs = new Map<string, Job>();
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  private readonly checks = new Set<AbortController>();
  constructor(private readonly options: InstallerOptions) {}
  private pin(name: string): ToolPin {
    toolNameSchema.parse(name);
    const pin = this.options.registry.basePins().filter((pin) => pin.name === name).sort((a, b) => compareVersions(b.version, a.version))[0];
    if (!pin) throw new IpcFailure({ code: 'not_found', message: 'Unknown tool.' }); return pin;
  }
  async ensureAll(): Promise<void> {
    for (const pin of this.options.registry.basePins()) {
      if (this.closed) return;
      const tool = (await this.options.registry.list()).find((tool) => tool.name === pin.name);
      if (tool?.status !== 'ok') await this.install(pin.name).catch(() => undefined);
    }
  }
  install(name: string, selected?: ToolPin): Promise<void> {
    if (this.closed) return Promise.reject(new IpcFailure({ code: 'unavailable', message: 'The app is shutting down.' }));
    const existing = this.jobs.get(name); if (existing) return existing.done;
    const pin = selected ?? this.pin(name);
    const controller = new AbortController();
    this.options.registry.setInstall(name, { state: 'queued', received: 0, total: null });
    const done = this.queue.then(async () => {
      try { controller.signal.throwIfAborted(); await this.perform(pin, controller.signal); this.options.registry.setInstall(name, null); await this.options.registry.refresh(); }
      catch (error) {
        if (controller.signal.aborted) this.options.registry.setInstall(name, null);
        else this.options.registry.setInstall(name, { state: 'failed', received: 0, total: null, error: error instanceof DownloadFailure ? error.message : 'Could not install this tool. Check disk permissions and available space; an existing different file must be removed explicitly.' });
        throw new IpcFailure({ code: 'unavailable', message: controller.signal.aborted ? 'Tool installation cancelled.' : error instanceof DownloadFailure ? error.message : 'Tool installation failed. See Settings › Tools and retry.' });
      } finally { this.jobs.delete(name); }
    });
    this.jobs.set(name, { controller, done }); this.queue = done.catch(() => undefined); return done;
  }
  async installPrerequisite(name: 'xcode-clt'): Promise<{ ok: true }> {
    z.literal('xcode-clt').parse(name);
    try {
      const result = await (this.options.run ?? runCommand)('/usr/bin/xcode-select', ['--install'], { env: BUILD_ENV, timeoutMs: 15000 });
      if (result.code !== 0) throw new Error();
      return { ok: true };
    } catch { throw new IpcFailure({ code: 'unavailable', message: 'Could not open Apple’s Command Line Tools installer. Try again from Settings › Tools.' }); }
  }
  private async performBuild(pin: ToolPin, signal: AbortSignal): Promise<void> {
    const registry = this.options.registry;
    if (!sourceIsPinned(pin)) throw new DownloadFailure(SOURCE_PIN_MESSAGE);
    const run = this.options.run ?? runCommand;
    const available = await hasDeveloperTools(run, signal);
    signal.throwIfAborted(); registry.setDeveloperToolsMissing(!available);
    if (!available) throw new DownloadFailure(CLT_MESSAGE);
    const cmake = registry.options.manifest.buildTools?.find((tool) => tool.name === 'cmake');
    if (!cmake) throw new DownloadFailure('The transcription build tool is not configured in this release.');
    registry.setInstall(pin.name, { state: 'downloading', received: 0, total: null });
    const cmakePath = await ensureCmake({ home: registry.options.home, pin: cmake, signal, run, fetch: this.options.fetch });
    const toolsRoot = await managedDirectory(registry.options.home, 'tools');
    const staging = await mkdtemp(path.join(toolsRoot, '.staging-'));
    try {
      const binary = await compileWhisper({ pin, signal, run, fetch: this.options.fetch, cmakePath, workDir: staging,
        onProgress: (received) => registry.setInstall(pin.name, { state: 'building', received, total: 100 }) });
      await verifyArchitecture(binary, registry.options.arch); const actual = await sha256(binary);
      if (pin.sha256 && pin.sha256 !== actual) throw new DownloadFailure('The transcription executable checksum does not match. Nothing was installed.');
      await chmod(binary, 0o755); await (this.options.clearQuarantine ?? clearQuarantine)(binary, signal);
      const target = await managedDirectory(registry.options.home, 'tools', pin.name, pin.version);
      signal.throwIfAborted(); await publishExclusive(binary, path.join(target, pin.name), actual);
      await registry.installed.record({ name: pin.name, version: pin.version, arch: pin.arch, sha256: actual, archiveSha256: pin.sourceSha256!, verification: 'built', installedAt: new Date().toISOString() });
    } finally { await rm(staging, { recursive: true, force: true }); }
  }
  private async perform(pin: ToolPin, signal: AbortSignal): Promise<void> {
    if (pin.source.format === 'build') return this.performBuild(pin, signal);
    const registry = this.options.registry;
    const toolsRoot = await managedDirectory(registry.options.home, 'tools');
    const staging = await mkdtemp(path.join(toolsRoot, '.staging-'));
    try {
      const downloads = path.join(staging, 'downloads'); const extracted = path.join(staging, 'extracted');
      await mkdir(downloads); await mkdir(extracted);
      if (!pin.source.url || !pin.checksum) throw new DownloadFailure('This tool has no download source.');
      let expected = pin.archiveSha256;
      if (!expected) {
        const file = path.join(downloads, 'checksum.txt');
        await download({ url: pin.checksum.url, file, policy: pin, limit: 1024 * 1024, signal, fetch: this.options.fetch });
        expected = checksumFromText(await readFile(file, 'utf8'), pin.checksum.format, pin.checksum.entry);
      }
      const archive = path.join(downloads, 'archive');
      const result = await download({ url: pin.source.url, file: archive, policy: pin, limit: 512 * 1024 * 1024, signal, fetch: this.options.fetch,
        onProgress: (received, total) => registry.setInstall(pin.name, { state: 'downloading', received, total }) });
      registry.setInstall(pin.name, { state: 'verifying', received: result.size, total: result.size });
      if (result.sha256 !== expected) throw new DownloadFailure('The downloaded archive checksum does not match. Nothing was installed.');
      const binary = path.join(extracted, pin.name);
      if (pin.source.format === 'zip') await (this.options.extract ?? extractZip)(archive, pin.source.entry!, binary, signal); else await copyFile(archive, binary);
      await verifyArchitecture(binary, registry.options.arch);
      const actual = await sha256(binary);
      if (pin.sha256 && actual !== pin.sha256) throw new DownloadFailure('The executable checksum does not match. Nothing was installed.');
      signal.throwIfAborted(); registry.setInstall(pin.name, { state: 'installing', received: result.size, total: result.size });
      await chmod(binary, 0o755); await (this.options.clearQuarantine ?? clearQuarantine)(binary, signal);
      const target = await managedDirectory(registry.options.home, 'tools', pin.name, pin.version);
      signal.throwIfAborted(); await publishExclusive(binary, path.join(target, pin.name), actual);
      await registry.installed.record({ name: pin.name, version: pin.version, arch: pin.arch, sha256: actual, archiveSha256: result.sha256, verification: pin.sha256 ? 'pinned' : 'upstream', installedAt: new Date().toISOString() });
    } finally { await rm(staging, { recursive: true, force: true }); }
  }
  async cancel(name: string): Promise<void> { this.pin(name); const job = this.jobs.get(name); if (job) { job.controller.abort(); await job.done.catch(() => undefined); } }
  async checkUpdate(name: string, automatic = false): Promise<{ current: string; latest: string | null }> {
    const base = this.pin(name);
    if (!base.updatable || name !== 'yt-dlp') throw new IpcFailure({ code: 'invalid_request', message: 'This tool does not support updates.' });
    const current = (await this.options.registry.list()).find((tool) => tool.name === name)?.version ?? base.version;
    const state = await this.options.registry.installed.read(); const old = state.checks[name];
    if (automatic && old && Date.now() - Date.parse(old.lastCheckedAt) < 86_400_000) return { current, latest: old.latest && compareVersions(old.latest, current) > 0 ? old.latest : null };
    const controller = new AbortController(); this.checks.add(controller);
    try {
      // Persist the attempt as well: an unavailable endpoint must not auto-loop.
      await this.options.registry.installed.update((state) => { state.checks[name] = { lastCheckedAt: new Date().toISOString(), latest: old?.latest ?? null }; });
      const response = await (this.options.fetch ?? fetch)('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest', { redirect: 'error', headers: { 'User-Agent': 'Cutroom/0.1', Accept: 'application/vnd.github+json' }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
      if (!response.ok) throw new Error('Update check failed.');
      const text = await response.text(); if (text.length > 1024 * 1024) throw new Error('Update response too large.');
      const result = z.object({ tag_name: z.string() }).passthrough().safeParse(JSON.parse(text));
      const tag = result.success && /^\d{4}\.\d{2}\.\d{2}$/.test(result.data.tag_name) ? result.data.tag_name : null;
      const latest = tag && compareVersions(tag, current) > 0 ? tag : null;
      await this.options.registry.installed.update((state) => { state.checks[name] = { lastCheckedAt: new Date().toISOString(), latest }; });
      await this.options.registry.refresh(); return { current, latest };
    } catch { throw new IpcFailure({ code: 'unavailable', message: 'Could not check for tool updates. Check your connection and retry.' }); }
    finally { this.checks.delete(controller); }
  }
  async update(name: string): Promise<void> {
    const base = this.pin(name);
    if (!base.updatable || name !== 'yt-dlp') throw new IpcFailure({ code: 'invalid_request', message: 'This tool does not support updates.' });
    const { latest } = await this.checkUpdate(name);
    if (latest) await this.install(name, releasePin(base, latest));
  }
  async close(): Promise<void> { this.closed = true; for (const controller of this.checks) controller.abort(); for (const job of this.jobs.values()) job.controller.abort(); await Promise.all([...this.jobs.values()].map((job) => job.done.catch(() => undefined))); this.options.registry.close(); }
}
