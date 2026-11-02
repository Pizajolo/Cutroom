import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { defaultGlobalSettings, globalSettingsSchema, migrateGlobalSettings, type GlobalSettings } from '@shared/schema/settings';

const missing = (error: unknown): boolean => error instanceof Error && 'code' in error && error.code === 'ENOENT';
export class SettingsStore {
  private pending: Promise<unknown> = Promise.resolve();
  private constructor(private readonly home: string, private settings: GlobalSettings) {}

  static async load(home = path.join(homedir(), '.cutroom')): Promise<SettingsStore> {
    const root = path.resolve(home);
    let settings = defaultGlobalSettings();
    let migrated = false;
    try {
      const file = await open(path.join(root, 'settings.json'), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        if (!(await file.stat()).isFile()) return new SettingsStore(root, settings);
        const value: unknown = JSON.parse(await file.readFile('utf8'));
        settings = migrateGlobalSettings(value);
        migrated = !globalSettingsSchema.safeParse(value).success;
      } finally { await file.close(); }
    } catch { /* Missing, unreadable or malformed settings must not prevent startup. */ }
    const store = new SettingsStore(root, settings);
    if (migrated) await store.update(() => settings);
    return store;
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
