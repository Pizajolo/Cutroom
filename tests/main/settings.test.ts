import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lstat, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SettingsStore } from '@main/settings/store';
import { defaultGlobalSettings, globalSettingsSchema } from '@shared/schema/settings';

let home: string;
beforeEach(async () => { home = await mkdtemp(path.join(tmpdir(), 'cutroom-settings-test-')); });
afterEach(async () => { await rm(home, { recursive: true }); });

describe('settings store', () => {
  it('loads defaults from a missing file without writing it', async () => {
    expect((await SettingsStore.load(home)).get()).toEqual(defaultGlobalSettings());
    expect(await readdir(home)).toEqual([]);
  });
  it('atomically writes a private file that round-trips and contains only references', async () => {
    const store = await SettingsStore.load(home);
    const next = await store.update((draft) => { draft.claude.auth = 'api-key'; draft.claude.credentialRef = 'cutroom:anthropic'; draft.openai.apiKeyRef = 'cutroom:openai'; });
    const file = path.join(home, 'settings.json');
    expect((await lstat(file)).mode & 0o777).toBe(0o600);
    expect(globalSettingsSchema.parse(JSON.parse(await readFile(file, 'utf8')))).toEqual(next);
    expect((await SettingsStore.load(home)).get()).toEqual(next);
    expect(await readdir(home)).toEqual(['settings.json']);
    const copy = store.get(); copy.claude.auth = 'claude-code';
    expect(store.get().claude.auth).toBe('api-key');
  });
  it.each(['{bad JSON', JSON.stringify({ version: 999 }), JSON.stringify({ ...defaultGlobalSettings(), apiKey: 'must-not-persist' })])('falls back on invalid settings without rewriting the file', async (raw) => {
    await writeFile(path.join(home, 'settings.json'), raw);
    expect((await SettingsStore.load(home)).get()).toEqual(defaultGlobalSettings());
    expect(await readFile(path.join(home, 'settings.json'), 'utf8')).toBe(raw);
  });
  it('migrates subscription auth and absent account metadata from older v1 settings', async () => {
    const old = { ...defaultGlobalSettings(), claude: { auth: 'subscription', credentialRef: 'keychain-ref' }, openai: undefined, accounts: undefined, whisperAutoDownloadSuppressed: undefined };
    await writeFile(path.join(home, 'settings.json'), JSON.stringify(old));
    const settings = (await SettingsStore.load(home)).get();
    expect(settings.claude).toEqual({ auth: 'claude-code', credentialRef: 'keychain-ref' });
    expect(settings.accounts.anthropic.status).toBe('not_connected');
    expect(settings.whisperAutoDownloadSuppressed).toEqual([]);
  });
  it('serializes concurrent updates and recovers after a rejected update', async () => {
    const store = await SettingsStore.load(home);
    await Promise.all([store.update((draft) => { draft.appearance = 'dark'; }), store.update((draft) => { draft.whisperModel = 'small'; })]);
    expect(store.get()).toMatchObject({ appearance: 'dark', whisperModel: 'small' });
    const before = await readFile(path.join(home, 'settings.json'), 'utf8');
    await expect(store.update((draft) => { draft.snapshots.retainDays = -1; })).rejects.toThrow();
    expect(await readFile(path.join(home, 'settings.json'), 'utf8')).toBe(before);
    await store.update((draft) => { draft.renderPreset = 'final'; });
    expect(store.get().renderPreset).toBe('final');
  });
  it('refuses a settings symlink without mutating its target', async () => {
    const target = path.join(home, 'foreign.json'); await writeFile(target, 'do not overwrite');
    await symlink(target, path.join(home, 'settings.json'));
    const store = await SettingsStore.load(home);
    expect(store.get()).toEqual(defaultGlobalSettings());
    await expect(store.update((draft) => { draft.appearance = 'dark'; })).rejects.toThrow('not a regular file');
    expect(await readFile(target, 'utf8')).toBe('do not overwrite');
    expect((await lstat(path.join(home, 'settings.json'))).isSymbolicLink()).toBe(true);
    expect(store.get()).toEqual(defaultGlobalSettings());
  });
});
