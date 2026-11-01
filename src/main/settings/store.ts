import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { defaultGlobalSettings, globalSettingsSchema, type GlobalSettings } from '@shared/schema/settings';

const missing = (error: unknown): boolean => error instanceof Error && 'code' in error && error.code === 'ENOENT';
export class SettingsStore {
  private pending: Promise<unknown> = Promise.resolve();
  private constructor(private readonly home: string, private settings: GlobalSettings) {}

  static async load(home = path.join(homedir(), '.cutroom')): Promise<SettingsStore> {
    const root = path.resolve(home);
    let settings = defaultGlobalSettings();
    try {
      const file = await open(path.join(root, 'settings.json'), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        if (!(await file.stat()).isFile()) return new SettingsStore(root, settings);
        const value: unknown = JSON.parse(await file.readFile('utf8'));
        // Previous v1 settings used "subscription" for the Claude Code login.
        if (value && typeof value === 'object' && 'claude' in value && value.claude && typeof value.claude === 'object' && 'auth' in value.claude && value.claude.auth === 'subscription') value.claude.auth = 'claude-code';
        const parsed = globalSettingsSchema.safeParse(value);
        if (parsed.success) settings = parsed.data;
      } finally { await file.close(); }
    } catch { /* Missing, unreadable or malformed settings must not prevent startup. */ }
    return new SettingsStore(root, settings);
  }

  get(): GlobalSettings { return structuredClone(this.settings); }

  update(fn: (draft: GlobalSettings) => GlobalSettings | void): Promise<GlobalSettings> {
    const operation = this.pending.then(async () => {
      const draft = this.get();
      const next = globalSettingsSchema.parse(fn(draft) ?? draft);
      await mkdir(this.home, { recursive: true, mode: 0o700 });
      const root = await realpath(this.home);
      const target = path.join(root, 'settings.json');
      // Never follow or replace a foreign symlink/directory at the fixed target.
      try { if (!(await lstat(target)).isFile()) throw new Error('Settings target is not a regular file.'); }
      catch (error) { if (!missing(error)) throw error; }
      const temporary = path.join(root, `.settings-${randomUUID()}.json`);
      try {
        const file = await open(temporary, 'wx', 0o600);
        try { await file.writeFile(`${JSON.stringify(next, null, 2)}\n`); await file.sync(); }
        finally { await file.close(); }
        await rename(temporary, target);
        this.settings = next;
        return this.get();
      } finally { await rm(temporary, { force: true }); }
    });
    this.pending = operation.catch(() => undefined);
    return operation;
  }
}
