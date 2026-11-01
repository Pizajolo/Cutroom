import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, readlink, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ToolInfo } from '../../shared/schema/media';
import { compareVersions, type ToolPin, type ToolsManifest } from './manifest';

interface CacheEntry { size: number; mtimeMs: number; ctimeMs: number; ino: number; sha256: string }
export interface RegistryOptions {
  home: string;
  bundledRoot: string;
  arch: string;
  manifest: ToolsManifest;
  onChanged?: (tools: ToolInfo[]) => void;
}
export class ToolUnavailable extends Error {
  constructor(public readonly tool: string, public readonly status: ToolInfo['status']) {
    super(`${tool} is ${status === 'missing' ? 'not installed' : 'not checksum-verified'}.`);
    this.name = 'ToolUnavailable';
  }
}
const contained = (root: string, target: string): boolean => {
  const rel = path.relative(root, target);
  return rel === '' || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`));
};
export class ToolRegistry {
  private readonly cache = new Map<string, CacheEntry>();
  private tools: ToolInfo[] = [];
  private refreshing: Promise<ToolInfo[]> | undefined;
  constructor(private readonly options: RegistryOptions) {}
  async initialize(): Promise<void> {
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
  private async verify(file: string, root: string, pin: ToolPin): Promise<ToolInfo['status']> {
    try {
      const canonicalRoot = await realpath(root); const resolved = await realpath(file);
      const expected = path.resolve(canonicalRoot, path.relative(path.resolve(root), path.resolve(file)));
      if (!contained(canonicalRoot, resolved) || resolved !== expected) return 'checksum_mismatch';
      const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const before = await handle.stat();
        if (!before.isFile() || (before.mode & 0o111) === 0 || !pin.sha256) return 'checksum_mismatch';
        const cached = this.cache.get(file);
        if (cached?.size === before.size && cached.mtimeMs === before.mtimeMs && cached.ctimeMs === before.ctimeMs && cached.ino === before.ino && cached.sha256 === pin.sha256) return 'ok';
        const hash = createHash('sha256');
        for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
        const after = await handle.stat();
        if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || hash.digest('hex') !== pin.sha256) { this.cache.delete(file); return 'checksum_mismatch'; }
        this.cache.set(file, { size: before.size, mtimeMs: before.mtimeMs, ctimeMs: before.ctimeMs, ino: before.ino, sha256: pin.sha256 });
        return 'ok';
      } finally { await handle.close(); }
    } catch (error) {
      return error instanceof Error && 'code' in error && error.code === 'ENOENT' ? 'missing' : 'checksum_mismatch';
    }
  }
  async list(): Promise<ToolInfo[]> { return this.refresh(); }
  async resolve(name: string): Promise<string> {
    const tool = (await this.refresh()).find((entry) => entry.name === name);
    if (!tool || tool.status !== 'ok') throw new ToolUnavailable(name, tool?.status ?? 'missing');
    return tool.path;
  }
  refresh(): Promise<ToolInfo[]> {
    if (!this.refreshing) this.refreshing = this.update().finally(() => { this.refreshing = undefined; });
    return this.refreshing;
  }
  private async update(): Promise<ToolInfo[]> {
    const root = path.resolve(this.options.bundledRoot);
    const updates = path.resolve(this.options.home, 'tools');
    const pins = this.options.manifest.tools.filter((pin) => pin.arch === this.options.arch);
    const result: ToolInfo[] = [];
    for (const name of new Set(pins.map((pin) => pin.name))) {
      const versions = pins.filter((pin) => pin.name === name).sort((a, b) => compareVersions(b.version, a.version));
      const bundledPin = versions.find((pin) => pin.bundled); if (!bundledPin) continue;
      let chosen: ToolInfo | undefined;
      for (const pin of versions) {
        if (compareVersions(pin.version, bundledPin.version) <= 0) continue;
        const file = path.join(updates, name, pin.version, name);
        const status = await this.verify(file, updates, pin);
        if (status === 'ok') { chosen = { name, version: pin.version, path: file, source: 'updated', status }; break; }
      }
      if (!chosen) {
        const file = path.join(root, name);
        chosen = { name, version: bundledPin.version, path: file, source: 'bundled', status: await this.verify(file, root, bundledPin) };
      }
      result.push(chosen);
      if (chosen.status === 'ok') await this.link(chosen).catch(() => { /* PATH shortcuts are optional, never a reason to trust another executable. */ });
      else await this.unlinkManaged(name).catch(() => { /* A foreign shortcut is never removed. */ });
    }
    const changed = JSON.stringify(result) !== JSON.stringify(this.tools);
    this.tools = result;
    await mkdir(this.options.home, { recursive: true });
    const temp = path.join(this.options.home, `.tools-cache-${randomUUID()}.json`);
    try { await writeFile(temp, JSON.stringify(Object.fromEntries(this.cache)), { flag: 'wx', mode: 0o600 }); await rename(temp, path.join(this.options.home, 'tools-cache.json')); }
    finally { await rm(temp, { force: true }); }
    if (changed) this.options.onChanged?.(structuredClone(result));
    return structuredClone(result);
  }
  private async unlinkManaged(name: string): Promise<void> {
    const bin = path.join(this.options.home, 'bin'); const target = path.join(bin, name);
    try {
      if (!(await lstat(target)).isSymbolicLink()) return;
      const old = path.resolve(bin, await readlink(target));
      if (contained(path.resolve(this.options.bundledRoot), old) || contained(path.resolve(this.options.home, 'tools'), old)) await rm(target);
    } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
  }
  private async link(tool: ToolInfo): Promise<void> {
    const bin = path.join(this.options.home, 'bin'); await mkdir(bin, { recursive: true });
    const target = path.join(bin, tool.name);
    try {
      const info = await lstat(target);
      if (!info.isSymbolicLink()) return;
      const old = path.resolve(bin, await readlink(target));
      if (!contained(path.resolve(this.options.bundledRoot), old) && !contained(path.resolve(this.options.home, 'tools'), old)) return;
      if (old === tool.path) return;
    } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
    const temp = path.join(bin, `.${tool.name}-${randomUUID()}`);
    try { await symlink(tool.path, temp); await rename(temp, target); } finally { await rm(temp, { force: true }); }
  }
}
