import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { SettingsStore } from '@main/settings/store';
import { SettingsService } from '@main/settings/service';
import { StorageService } from '@main/settings/storage';
import { ExtensionsService } from '@main/settings/extensions';
import { snapshotsToPrune } from '@main/timeline/retention';
import { BUILTIN_PRESETS } from '@main/render/presets';
import type { SettingsPatch } from '@shared/schema/settings';
import type { ExtensionSecretStore } from '@main/secrets/keychain';
import type { ProjectSession } from '@shared/schema/project';

const roots: string[] = [];
async function setup() { const root = await mkdtemp(path.join(process.env.TMPDIR ?? tmpdir(), 'cutroom-settings-service-')); roots.push(root); return { root, store: await SettingsStore.load(root) }; }
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe('nonsecret settings updates', () => {
  it('rejects invalid domain rules, unknown fields and disconnected Scribe, and persists valid patches', async () => {
    const { root, store } = await setup(); const service = new SettingsService(store, () => {});
    for (const patch of [{ sandbox: { networkByDefault: true } }, { sandbox: { allowedDomains: ['https://example.org/path'] } }, { unknown: true }, { voiceInput: { engine: 'scribe' } }]) await expect(service.update(patch as SettingsPatch)).rejects.toThrow();
    await service.update({ appearance: 'light', sandbox: { allowedDomains: ['example.org'], allowShell: true } }); expect((await SettingsStore.load(root)).get().sandbox).toMatchObject({ allowedDomains: ['example.org'], allowShell: true, networkByDefault: false });
  });
  it('merges and persists agent approval preferences without changing sandbox limits', async () => {
    const { root, store } = await setup(); const service = new SettingsService(store, () => {});
    const sandbox = store.get().sandbox;
    await service.update({ agent: { approvalMode: 'ask' } });
    await service.update({ agent: {} });
    expect((await SettingsStore.load(root)).get()).toMatchObject({ agent: { approvalMode: 'ask' }, sandbox });
    await expect(service.update({ agent: { approvalMode: 'unsafe' } } as unknown as SettingsPatch)).rejects.toThrow();
  });
  it('protects builtins and requires the selected custom preset to remain present', async () => {
    const { store } = await setup(); const service = new SettingsService(store, () => {}); const custom = { ...BUILTIN_PRESETS[0]!, id: 'mine', builtin: false };
    await service.update({ renderPresets: { defaultId: 'mine', custom: [custom] } }); await expect(service.update({ renderPresets: { defaultId: 'mine', custom: [] } })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(service.update({ renderPresets: { defaultId: 'draft', custom: [{ ...custom, id: 'draft' }] } })).rejects.toMatchObject({ code: 'invalid_request' });
  });
});

describe('cleanup capabilities and snapshot retention', () => {
  it('deletes only unchanged previewed entries and refuses token reuse and protected categories', async () => {
    const { root } = await setup(); await mkdir(path.join(root, 'tools')); await mkdir(path.join(root, 'models')); await mkdir(path.join(root, 'work/logs'), { recursive: true }); await writeFile(path.join(root, 'work/logs/old.log'), 'old');
    const project = { project: { id: 'project' }, rootPath: root };
    const storage = new StorageService({ home: root, current: () => project as ProjectSession, newestSnapshot: async () => undefined, busy: () => false });
    const preview = await storage.preview(['logs']); expect(preview.bytes).toBe(3); await writeFile(path.join(root, 'work/logs/new.log'), 'new'); await storage.clean(preview.token); expect(await readFile(path.join(root, 'work/logs/new.log'), 'utf8')).toBe('new'); await expect(storage.clean(preview.token)).rejects.toMatchObject({ code: 'forbidden' }); await expect(storage.preview(['final'])).rejects.toMatchObject({ code: 'forbidden' });
    const changed = await storage.preview(['logs']); await writeFile(path.join(root, 'work/logs/new.log'), 'modified'); await expect(storage.clean(changed.token)).rejects.toMatchObject({ code: 'conflict' }); expect(await readFile(path.join(root, 'work/logs/new.log'), 'utf8')).toBe('modified');
  });
  it('never follows symlink escapes while scanning cleanup roots', async () => {
    const { root } = await setup(); await mkdir(path.join(root, 'tools')); await mkdir(path.join(root, 'models')); await mkdir(path.join(root, 'work/logs'), { recursive: true }); await writeFile(path.join(root, 'source.txt'), 'keep'); await symlink('../../source.txt', path.join(root, 'work/logs/alias.log'));
    const storage = new StorageService({ home: root, current: () => ({ project: { id: 'project' }, rootPath: root }) as ProjectSession, newestSnapshot: async () => undefined, busy: () => false }); const preview = await storage.preview(['logs']); expect(preview.items).toEqual([]); await storage.clean(preview.token); expect(await readFile(path.join(root, 'source.txt'), 'utf8')).toBe('keep');
  });
  it('always keeps newest even when it exceeds the byte budget', () => {
    const now = Date.parse('2026-11-02T12:00:00Z'); const snapshots = [0, 1, 2].map((offset) => ({ id: String(offset), label: 'Snapshot', revision: offset, bytes: 100, createdAt: new Date(now - offset * 86_400_000).toISOString() })); expect(snapshotsToPrune(snapshots, { retainDays: 30, maxBytes: 150 }, now)).toEqual(['1', '2']); expect(snapshotsToPrune(snapshots, { retainDays: 30, maxBytes: 1 }, now)).toEqual(['1', '2']);
  });
});

it('stores extension secrets only in Keychain and reports built-in flags', async () => {
  const { root, store } = await setup(); const values = new Map<string, string>(); const secrets: ExtensionSecretStore = { getExtension: async (id, name) => values.get(`${id}/${name}`) ?? null, setExtension: async (id, name, value) => { values.set(`${id}/${name}`, value); }, deleteExtension: async (id, name) => { values.delete(`${id}/${name}`); } };
  const service = new ExtensionsService({ store, secrets, changed: () => {} });
  expect(() => service.validate({ id: 'remote', name: 'Remote', enabled: false, transport: 'http', url: 'http://example.org' })).toThrow(); expect(() => service.validate({ id: 'relative', name: 'Relative', enabled: false, transport: 'stdio', command: 'relative', args: [] })).toThrow();
  await service.add({ config: { id: 'mine', name: 'Mine', enabled: false, transport: 'stdio', command: '/usr/bin/example', args: [] }, secretEnv: { SERVICE_API_KEY: 'sensitive-test-secret' } }); expect(values.get('mine/SERVICE_API_KEY')).toBe('sensitive-test-secret'); expect(await readFile(path.join(root, 'settings.json'), 'utf8')).not.toContain('sensitive-test-secret'); expect(await service.list()).toHaveLength(5); await service.setEnabled('codex', true); expect(service.enabled('codex')).toBe(true);
});
