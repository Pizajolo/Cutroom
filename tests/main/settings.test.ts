import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lstat, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SettingsStore } from '@main/settings/store';
import { defaultGlobalSettings, globalSettingsSchema, globalSettingsV1Schema } from '@shared/schema/settings';

function legacySettings() {
  const { voiceInput, sandbox, snapshots, renderPresets, extensions: _extensions, agent: _agent, ...rest } = defaultGlobalSettings();
  void _extensions; void _agent;
  return globalSettingsV1Schema.parse({
    ...rest, version: 1, voiceInput: voiceInput.engine, renderPreset: renderPresets.defaultId,
    sandbox: { networkByDefault: sandbox.networkByDefault, allowedDomains: sandbox.allowedDomains },
    snapshots: { retainDays: snapshots.retainDays, maxBytes: snapshots.maxBytes },
  });
}

let home: string;
beforeEach(async () => { home = await mkdtemp(path.join(tmpdir(), 'cutroom-settings-test-')); });
afterEach(async () => { await rm(home, { recursive: true }); });

describe('settings store', () => {
  it('loads defaults from a missing file without writing it', async () => {
    expect((await SettingsStore.load(home)).get()).toEqual(defaultGlobalSettings());
    expect(await readdir(home)).toEqual([]);
  });
  it('loads an existing v2 file without agent settings using auto approval', async () => {
    const { agent: _agent, ...old } = defaultGlobalSettings(); void _agent;
    old.appearance = 'dark';
    await writeFile(path.join(home, 'settings.json'), JSON.stringify(old));
    const store = await SettingsStore.load(home);
    expect(store.get()).toEqual({ ...old, agent: { approvalMode: 'auto' } });
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
    const old = { ...legacySettings(), claude: { auth: 'subscription', credentialRef: 'keychain-ref' }, openai: undefined, accounts: undefined, whisperAutoDownloadSuppressed: undefined };
    await writeFile(path.join(home, 'settings.json'), JSON.stringify(old));
    const settings = (await SettingsStore.load(home)).get();
    expect(settings.claude).toEqual({ auth: 'claude-code', credentialRef: 'keychain-ref' });
    expect(settings.accounts.anthropic.status).toBe('not_connected');
    expect(settings.whisperAutoDownloadSuppressed).toEqual([]);
  });
  it.each(['whisper', 'scribe'] as const)('persists a lossless v1 to v2 migration with private permissions (%s)', async (engine) => {
    const old = legacySettings();
    old.appearance = 'dark'; old.defaultEngine = 'remotion'; old.voiceInput = engine; old.whisperModel = 'small';
    old.whisperAutoDownloadSuppressed = ['base']; old.claude = { auth: 'api-key', credentialRef: 'keychain:anthropic' };
    old.openai.apiKeyRef = 'keychain:openai'; old.elevenLabs = { apiKeyRef: 'keychain:elevenlabs', oauthRef: 'keychain:eleven-oauth' };
    old.accounts.openai = { keyPreview: '…1234', status: 'connected', checkedAt: '2026-11-01T12:00:00.000Z' };
    old.sandbox.allowedDomains = ['example.com', '*.example.org']; old.snapshots = { retainDays: 90, maxBytes: 123456789 }; old.renderPreset = 'final';
    old.remotionLicenseAcknowledgedAt = '2026-10-01T12:00:00.000Z';
    const file = path.join(home, 'settings.json'); await writeFile(file, JSON.stringify(old), { mode: 0o644 });
    const settings = (await SettingsStore.load(home)).get();
    expect(settings).toMatchObject({
      version: 2, appearance: old.appearance, defaultEngine: old.defaultEngine, accounts: old.accounts,
      claude: old.claude, openai: old.openai, elevenLabs: old.elevenLabs, whisperModel: old.whisperModel,
      whisperAutoDownloadSuppressed: old.whisperAutoDownloadSuppressed, remotionLicenseAcknowledgedAt: old.remotionLicenseAcknowledgedAt,
      voiceInput: { engine, model: engine === 'whisper' ? 'small' : 'scribe_v1' },
      sandbox: { ...old.sandbox, allowShell: false, allowWeb: false },
      snapshots: { ...old.snapshots, autoBeforeAgent: true, autoBeforeExport: true }, renderPresets: { defaultId: 'final', custom: [] }, extensions: [],
    });
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(settings);
    expect((await lstat(file)).mode & 0o777).toBe(0o600);
    expect((await SettingsStore.load(home)).get()).toEqual(settings);
    expect(await readdir(home)).toEqual(['settings.json']);
  });
  it('serializes concurrent updates and recovers after a rejected update', async () => {
    const store = await SettingsStore.load(home);
    await Promise.all([store.update((draft) => { draft.appearance = 'dark'; }), store.update((draft) => { draft.whisperModel = 'small'; })]);
    expect(store.get()).toMatchObject({ appearance: 'dark', whisperModel: 'small' });
    const before = await readFile(path.join(home, 'settings.json'), 'utf8');
    await expect(store.update((draft) => { draft.snapshots.retainDays = -1; })).rejects.toThrow();
    expect(await readFile(path.join(home, 'settings.json'), 'utf8')).toBe(before);
    await store.update((draft) => { draft.renderPresets.defaultId = 'final'; });
    expect(store.get().renderPresets.defaultId).toBe('final');
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
