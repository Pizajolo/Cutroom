import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readFile, readlink, realpath, rm, symlink, rename } from 'node:fs/promises';
import path from 'node:path';
import type { InstallState, ToolInfo } from '@shared/schema/media';
import { compareVersions, type ToolPin, type ToolsManifest } from './manifest';
import { InstalledStore, type InstalledTool } from './installed';
import { atomicJson, contained, isMissing, managedDirectory } from './files';

interface CacheEntry { size: number; mtimeMs: number; ctimeMs: number; ino: number; sha256: string }
export interface RegistryOptions { home: string; bundledRoot: string; arch: string; manifest: ToolsManifest; onChanged?: (tools: ToolInfo[]) => void }
export class ToolUnavailable extends Error {
  constructor(public readonly tool: string, public readonly status: ToolInfo['status']) { super(`${tool} is ${status === 'missing' ? 'not installed' : 'not checksum-verified'}.`); this.name = 'ToolUnavailable'; }
}
export function releasePin(base: ToolPin, version: string): ToolPin {
  if (base.name !== 'yt-dlp' || !/^\d{4}\.\d{2}\.\d{2}$/.test(version)) throw new Error('Invalid update release.');
  return { ...base, version, bundled: false, source: { format: 'raw', url: `https://github.com/yt-dlp/yt-dlp/releases/download/${version}/yt-dlp_macos` }, checksum: { format: 'sums', url: `https://github.com/yt-dlp/yt-dlp/releases/download/${version}/SHA2-256SUMS`, entry: 'yt-dlp_macos' }, archiveSha256: null, sha256: null };
}
export class ToolRegistry {
  readonly installed: InstalledStore;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly installs = new Map<string, InstallState>();
  private tools: ToolInfo[] = [];
  private refreshing: Promise<ToolInfo[]> | undefined;
  private emitTimer?: ReturnType<typeof setTimeout>;
  private lastEmitted = 0;
  private lastPayload = '';
  constructor(readonly options: RegistryOptions) { this.installed = new InstalledStore(options.home); }
  basePins(): ToolPin[] { return this.options.manifest.tools.filter((pin) => pin.arch === this.options.arch || pin.arch === 'universal'); }
  async initialize(): Promise<void> {
    await managedDirectory(this.options.home, 'tools');
    try {
      const value: unknown = JSON.parse(await readFile(path.join(this.options.home, 'tools-cache.json'), 'utf8'));
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const [key, entry] of Object.entries(value)) {
          if (entry && typeof entry === 'object' && 'size' in entry && typeof entry.size === 'number' && 'mtimeMs' in entry && typeof entry.mtimeMs === 'number' && 'ctimeMs' in entry && typeof entry.ctimeMs === 'number' && 'ino' in entry && typeof entry.ino === 'number' && 'sha256' in entry && typeof entry.sha256 === 'string' && /^[a-f0-9]{64}$/.test(entry.sha256)) this.cache.set(key, entry as CacheEntry);
        }
      }
    } catch { /* A missing or invalid cache never makes a tool trusted. */ }
    await this.refresh();
  }
  private async verify(file: string, root: string, expectedHash: string | null): Promise<ToolInfo['status']> {
    try {
      const canonicalRoot = await realpath(root); const resolved = await realpath(file);
      const expected = path.resolve(canonicalRoot, path.relative(path.resolve(root), path.resolve(file)));
      if (!contained(canonicalRoot, resolved) || resolved !== expected) return 'checksum_mismatch';
      const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const before = await handle.stat();
        if (!before.isFile() || (before.mode & 0o111) === 0 || !expectedHash) return 'checksum_mismatch';
        const cached = this.cache.get(file);
        if (cached?.size === before.size && cached.mtimeMs === before.mtimeMs && cached.ctimeMs === before.ctimeMs && cached.ino === before.ino && cached.sha256 === expectedHash) return 'ok';
        const hash = createHash('sha256'); for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
        const after = await handle.stat();
        if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || hash.digest('hex') !== expectedHash) { this.cache.delete(file); return 'checksum_mismatch'; }
        this.cache.set(file, { size: before.size, mtimeMs: before.mtimeMs, ctimeMs: before.ctimeMs, ino: before.ino, sha256: expectedHash }); return 'ok';
      } finally { await handle.close(); }
    } catch (error) { return isMissing(error) ? 'missing' : 'checksum_mismatch'; }
  }
  async list(): Promise<ToolInfo[]> { return this.refresh(); }
  async resolve(name: string): Promise<string> {
    const tool = (await this.refresh()).find((entry) => entry.name === name);
    if (!tool || tool.status !== 'ok') throw new ToolUnavailable(name, tool?.status ?? 'missing'); return tool.path;
  }
  setInstall(name: string, install: InstallState | null): void {
    if (install) this.installs.set(name, install); else this.installs.delete(name);
    this.tools = this.tools.map((tool) => tool.name === name ? { ...tool, install } : tool); this.scheduleEmit();
  }
  private scheduleEmit(): void {
    if (this.emitTimer) return;
    const send = (): void => { this.emitTimer = undefined; const payload = JSON.stringify(this.tools); if (payload !== this.lastPayload) { this.lastPayload = payload; this.lastEmitted = Date.now(); this.options.onChanged?.(structuredClone(this.tools)); } };
    const wait = Math.max(0, 250 - (Date.now() - this.lastEmitted));
    if (!wait) send(); else { this.emitTimer = setTimeout(send, wait); this.emitTimer.unref(); }
  }
  close(): void { if (this.emitTimer) clearTimeout(this.emitTimer); }
  refresh(): Promise<ToolInfo[]> { if (!this.refreshing) this.refreshing = this.update().finally(() => { this.refreshing = undefined; }); return this.refreshing; }
  private async update(): Promise<ToolInfo[]> {
    const root = path.resolve(this.options.bundledRoot); const updates = path.resolve(this.options.home, 'tools');
    const state = await this.installed.read(); const pins = this.basePins(); const result: ToolInfo[] = [];
    for (const name of new Set(pins.map((pin) => pin.name))) {
      const versions = pins.filter((pin) => pin.name === name).sort((a, b) => compareVersions(b.version, a.version));
      const base = versions.find((pin) => pin.bundled) ?? versions[0]; if (!base) continue;
      if (name === 'yt-dlp' && base.updatable) {
        for (const record of state.records.filter((record) => record.name === name && (record.arch === this.options.arch || record.arch === 'universal') && record.verification === 'upstream' && /^\d{4}\.\d{2}\.\d{2}$/.test(record.version))) if (!versions.some((pin) => pin.version === record.version)) versions.push(releasePin(base, record.version));
      }
      versions.sort((a, b) => compareVersions(b.version, a.version));
      const candidates: ToolInfo[] = [];
      for (const pin of versions) {
        const record: InstalledTool | undefined = state.records.find((record) => record.name === name && record.version === pin.version && record.arch === pin.arch);
        const hash = pin.sha256 ?? (record?.verification === 'upstream' ? record.sha256 : null);
        const file = path.join(updates, name, pin.version, name);
        const status = await this.verify(file, updates, hash);
        candidates.push({ name, version: pin.version, path: file, source: compareVersions(pin.version, base.version) > 0 ? 'updated' : 'downloaded', status, verification: status === 'ok' ? (pin.sha256 ? 'pinned' : 'upstream') : null, install: this.installs.get(name) ?? null, updatable: pin.updatable, latestVersion: null, hint: null, action: null });
        if (pin.bundled) {
          const bundled = path.join(root, name); const status = await this.verify(bundled, root, pin.sha256);
          candidates.push({ ...candidates[candidates.length - 1]!, path: bundled, source: 'bundled', status, verification: status === 'ok' ? 'pinned' : null });
        }
      }
      const chosen = candidates.find((candidate) => candidate.status === 'ok') ?? candidates.find((candidate) => candidate.status === 'checksum_mismatch') ?? candidates.find((candidate) => candidate.version === base.version && candidate.source === 'bundled') ?? candidates[0];
      if (!chosen) continue;
      if (base.source.format === 'build' && chosen.status !== 'ok') chosen.hint = 'Build with npm run build:whisper (requires cmake and Xcode Command Line Tools)';
      const latest = state.checks[name]?.latest; chosen.latestVersion = latest && compareVersions(latest, chosen.version) > 0 ? latest : null;
      result.push(chosen);
      if (chosen.status === 'ok') await this.link(chosen).catch(() => undefined); else await this.unlinkManaged(name).catch(() => undefined);
    }
    const changed = JSON.stringify(result) !== JSON.stringify(this.tools); this.tools = result;
    const home = await managedDirectory(this.options.home); await atomicJson(path.join(home, 'tools-cache.json'), Object.fromEntries(this.cache));
    if (changed) this.scheduleEmit(); return structuredClone(result);
  }
  private async unlinkManaged(name: string): Promise<void> {
    const bin = path.join(this.options.home, 'bin'); const target = path.join(bin, name);
    try { if (!(await lstat(target)).isSymbolicLink()) return; const old = path.resolve(bin, await readlink(target)); if (contained(path.resolve(this.options.bundledRoot), old) || contained(path.resolve(this.options.home, 'tools'), old)) await rm(target); }
    catch (error) { if (!isMissing(error)) throw error; }
  }
  private async link(tool: ToolInfo): Promise<void> {
    const bin = await managedDirectory(this.options.home, 'bin'); const target = path.join(bin, tool.name);
    try { const info = await lstat(target); if (!info.isSymbolicLink()) return; const old = path.resolve(bin, await readlink(target)); if (!contained(path.resolve(this.options.bundledRoot), old) && !contained(path.resolve(this.options.home, 'tools'), old)) return; if (old === tool.path) return; }
    catch (error) { if (!isMissing(error)) throw error; }
    const temp = path.join(bin, `.${tool.name}-${randomUUID()}`);
    try { await symlink(tool.path, temp); await rename(temp, target); } finally { await rm(temp, { force: true }); }
  }
}
