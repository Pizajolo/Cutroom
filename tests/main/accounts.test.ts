import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AccountsService } from '@main/accounts/service';
import { SettingsStore } from '@main/settings/store';
import type { SecretStore } from '@main/secrets/keychain';
import { providerSchema, type ClaudeCodeStatus, type Provider } from '@shared/schema/accounts';
import type { Fetch } from '@main/tools/download';

const homes: string[] = []; const services: AccountsService[] = [];
afterEach(async () => { await Promise.all(services.splice(0).map((service) => service.close())); await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true }))); });
const key = 'test-secret-key-only-last-1234';
const loggedOut: ClaudeCodeStatus = { available: true, loggedIn: false, authMethod: 'none', email: null, organization: null, cliVersion: '2.1.208', binarySource: 'installed' };
async function fixture(fetch: Fetch, claudeCode = { status: async (): Promise<ClaudeCodeStatus> => loggedOut }): Promise<{ home: string; settings: SettingsStore; secrets: SecretStore; keys: Map<Provider, string>; service: AccountsService }> {
  const home = await mkdtemp(path.join(tmpdir(), 'cutroom-accounts-test-')); homes.push(home); const settings = await SettingsStore.load(home);
  const keys = new Map<Provider, string>();
  const secrets: SecretStore = { get: vi.fn(async (provider) => keys.get(provider) ?? null), set: vi.fn(async (provider, value) => { keys.set(provider, value); }), delete: vi.fn(async (provider) => { keys.delete(provider); }) };
  const service = new AccountsService({ settings, secrets, fetch, claudeCode, timeoutMs: 10 }); services.push(service); return { home, settings, secrets, keys, service };
}
describe.each(providerSchema.options)('%s API-key account', (provider) => {
  it('verifies before storing, exposes only a preview and persists no secret material', async () => {
    const fetch = vi.fn<Fetch>(async () => Response.json({ subscription: { tier: 'creator', character_count: 10, character_limit: 100 } }));
    const { service, home, secrets, keys, settings } = await fixture(fetch);
    const connected = await service.connectKey(provider, ` ${key} `);
    expect(connected).toMatchObject({ status: 'connected', method: 'api-key', keyPreview: '…1234' });
    if (provider === 'elevenlabs') expect(connected.detail).toBe('creator plan · 10 of 100 characters used');
    expect(keys.get(provider)).toBe(key); expect(JSON.stringify(connected)).not.toContain(key);
    expect(await readFile(path.join(home, 'settings.json'), 'utf8')).not.toContain(key);
    const call = fetch.mock.calls[0]; const headers = call?.[1]?.headers;
    expect(headers).toMatchObject(provider === 'anthropic' ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' } : provider === 'openai' ? { Authorization: `Bearer ${key}` } : { 'xi-api-key': key });
    const reads = vi.mocked(secrets.get).mock.calls.length;
    const next = new AccountsService({ settings: await SettingsStore.load(home), secrets, fetch, claudeCode: { status: async () => loggedOut } }); services.push(next);
    expect(next.list().find((account) => account.provider === provider)?.status).toBe('connected'); expect(vi.mocked(secrets.get).mock.calls).toHaveLength(reads);
    await service.disconnect(provider); expect(keys.has(provider)).toBe(false); expect(service.list().find((account) => account.provider === provider)).toMatchObject({ status: 'not_connected', keyPreview: null });
    expect(settings.get().accounts[provider].status).toBe('not_connected');
  });
  it.each([401, 403])('does not store a rejected key (HTTP %s)', async (status) => {
    const { service, secrets, keys } = await fixture(async () => Response.json({ error: { message: key } }, { status }));
    await expect(service.connectKey(provider, key)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(secrets.set).not.toHaveBeenCalled(); expect(keys.size).toBe(0);
  });
  it('reports a timeout without storing a key and preserves an already connected key on verify', async () => {
    let online = true;
    const fetch: Fetch = async (_url, options) => {
      if (online) return Response.json({});
      return new Promise((_resolve, reject) => { options?.signal?.addEventListener('abort', () => reject(new Error(`timeout ${key}`)), { once: true }); });
    };
    const { service, secrets, keys } = await fixture(fetch);
    await service.connectKey(provider, key); online = false;
    await expect(service.connectKey(provider, 'other-secret-key-5678')).rejects.toMatchObject({ code: 'unavailable' });
    expect(secrets.set).toHaveBeenCalledOnce();
    expect(await service.verify(provider)).toMatchObject({ status: 'unreachable', keyPreview: '…1234' }); expect(keys.get(provider)).toBe(key);
    expect(JSON.stringify(service.list())).not.toContain(key);
  });
  it('marks an existing rejected key invalid without deleting it', async () => {
    let valid = true; const { service, keys } = await fixture(async () => valid ? Response.json({}) : Response.json({}, { status: 401 }));
    await service.connectKey(provider, key); valid = false;
    expect(await service.verify(provider)).toMatchObject({ status: 'invalid' }); expect(keys.get(provider)).toBe(key);
  });
});
describe('account security and Claude login selection', () => {
  it('handles ElevenLabs missing user_read permission as connected', async () => {
    const { service } = await fixture(async () => Response.json({ detail: { status: 'missing_permissions', message: key } }, { status: 401 }));
    expect(await service.connectKey('elevenlabs', key)).toMatchObject({ status: 'connected', detail: 'Key works; usage needs the user_read permission' });
  });
  it('validates a key before any fetch or keyring operation', async () => {
    const fetch = vi.fn<Fetch>(); const { service, secrets } = await fixture(fetch);
    await expect(service.connectKey('openai', 'abc')).rejects.toMatchObject({ code: 'invalid_request' }); expect(fetch).not.toHaveBeenCalled(); expect(secrets.set).not.toHaveBeenCalled();
  });
  it('has no plaintext or memory fallback when the Keychain fails', async () => {
    const { service, secrets, settings } = await fixture(async () => Response.json({}));
    vi.mocked(secrets.set).mockRejectedValueOnce(new Error(`keychain ${key}`));
    await expect(service.connectKey('openai', key)).rejects.toThrow(); expect(settings.get().accounts.openai.status).toBe('not_connected'); expect(JSON.stringify(service.list())).not.toContain(key);
  });
  it('requires the official CLI to be logged in and verifies Claude Code without touching Keychain', async () => {
    let signedIn = false; const status = vi.fn(async () => ({ ...loggedOut, loggedIn: signedIn, authMethod: signedIn ? 'claude.ai' as const : 'none' as const, email: signedIn ? 'person@example.com' : null }));
    const { service, secrets } = await fixture(vi.fn<Fetch>(), { status });
    await expect(service.setMethod('claude-code')).rejects.toMatchObject({ code: 'invalid_request' });
    signedIn = true; expect(await service.setMethod('claude-code')).toMatchObject({ status: 'connected', method: 'claude-code', keyPreview: null, detail: 'Signed in with Claude Code · person@example.com' });
    signedIn = false; expect(await service.verify('anthropic')).toMatchObject({ status: 'not_connected' }); expect(secrets.get).not.toHaveBeenCalled();
  });
});
