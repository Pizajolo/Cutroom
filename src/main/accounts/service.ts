import { z } from 'zod/v3';
import { IpcFailure } from '@shared/ipc/errors';
import { contract } from '@shared/ipc/contract';
import { accountMethodSchema, providerSchema, type AccountInfo, type ClaudeCodeStatus, type Provider } from '@shared/schema/accounts';
import { SettingsStore } from '../settings/store';
import type { SecretStore } from '../secrets/keychain';
import type { Fetch } from '../tools/download';

const LABEL = { anthropic: 'Claude', openai: 'OpenAI', elevenlabs: 'ElevenLabs' } as const;
const ENDPOINT = { anthropic: 'https://api.anthropic.com/v1/models?limit=1', openai: 'https://api.openai.com/v1/models', elevenlabs: 'https://api.elevenlabs.io/v1/user' } as const;
interface Verification { status: 'connected' | 'invalid' | 'unreachable'; detail: string | null }
export class AccountsService {
  private readonly details = new Map<Provider, string | null>();
  private readonly queues = new Map<Provider, Promise<unknown>>();
  private readonly active = new Set<AbortController>();
  private closed = false;
  constructor(private readonly options: { settings: SettingsStore; secrets: SecretStore; fetch?: Fetch; timeoutMs?: number; claudeCode: { status(): Promise<ClaudeCodeStatus> }; onChanged?: (accounts: AccountInfo[]) => void }) {}
  list(): AccountInfo[] {
    const settings = this.options.settings.get();
    return providerSchema.options.map((provider): AccountInfo => {
      const saved = settings.accounts[provider];
      const method = provider === 'anthropic' ? settings.claude.auth : (saved.keyPreview ? 'api-key' : null);
      return { provider, ...saved, method, keyPreview: method === 'claude-code' ? null : saved.keyPreview, detail: this.details.get(provider) ?? (provider === 'anthropic' && method === 'claude-code' && saved.status === 'connected' ? 'Signed in with Claude Code' : null) };
    });
  }
  private info(provider: Provider): AccountInfo { return this.list().find((account) => account.provider === provider)!; }
  private emit(): void { if (!this.closed) this.options.onChanged?.(this.list()); }
  private exclusive<T>(provider: Provider, action: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new IpcFailure({ code: 'unavailable', message: 'The app is shutting down.' }));
    const pending = (this.queues.get(provider) ?? Promise.resolve()).then(() => { if (this.closed) throw new IpcFailure({ code: 'unavailable', message: 'The app is shutting down.' }); return action(); }); this.queues.set(provider, pending.catch(() => undefined)); return pending;
  }
  private async checkKey(provider: Provider, key: string): Promise<Verification> {
    const controller = new AbortController(); this.active.add(controller);
    try {
      const headers: Record<string, string> = provider === 'anthropic' ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' } : provider === 'openai' ? { Authorization: `Bearer ${key}` } : { 'xi-api-key': key };
      const response = await (this.options.fetch ?? fetch)(ENDPOINT[provider], { headers, redirect: 'error', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(this.options.timeoutMs ?? 10_000)]) });
      let detail: string | null = null;
      if (provider === 'elevenlabs' && (response.ok || response.status === 401)) {
        // Parse only whitelisted usage fields, never remote error messages or key echoes.
        const text = await response.text(); if (text.length > 256 * 1024) return { status: 'unreachable', detail: 'The service response was too large.' };
        let value: unknown; try { value = JSON.parse(text); } catch { value = null; }
        const permissions = z.object({ detail: z.object({ status: z.literal('missing_permissions') }).passthrough() }).passthrough().safeParse(value);
        if (response.status === 401 && permissions.success) return { status: 'connected', detail: 'Key works; usage needs the user_read permission' };
        const usage = z.object({ subscription: z.object({ tier: z.string().max(64).regex(/^[\w -]+$/), character_count: z.number().int().nonnegative(), character_limit: z.number().int().nonnegative() }).passthrough() }).passthrough().safeParse(value);
        if (usage.success) { const subscription = usage.data.subscription; detail = `${subscription.tier} plan · ${subscription.character_count} of ${subscription.character_limit} characters used`; }
      } else await response.body?.cancel();
      if (response.ok) return { status: 'connected', detail };
      if (response.status === 401 || response.status === 403) return { status: 'invalid', detail: `${LABEL[provider]} rejected this key` };
      return { status: 'unreachable', detail: `${LABEL[provider]} could not be reached. Try again later.` };
    } catch { return { status: 'unreachable', detail: `${LABEL[provider]} could not be reached. Check your connection and retry.` }; }
    finally { this.active.delete(controller); }
  }
  connectKey(provider: Provider, apiKey: string): Promise<AccountInfo> {
    const parsed = contract.invoke['accounts.connectKey'].req.safeParse({ provider, apiKey });
    if (!parsed.success) return Promise.reject(new IpcFailure({ code: 'invalid_request', message: 'Enter a valid API key (8–512 characters, no internal whitespace).' }));
    apiKey = '';
    return this.exclusive(provider, async () => {
      let key = parsed.data.apiKey;
      try {
        const result = await this.checkKey(provider, key);
        if (result.status !== 'connected') throw new IpcFailure({ code: result.status === 'invalid' ? 'invalid_request' : 'unavailable', message: result.detail ?? `${LABEL[provider]} could not be reached.` });
        await this.options.secrets.set(provider, key);
        const keyPreview = `…${key.slice(-4)}`;
        await this.options.settings.update((draft) => {
          draft.accounts[provider] = { keyPreview, checkedAt: new Date().toISOString(), status: 'connected' };
          if (provider === 'anthropic') { draft.claude.auth = 'api-key'; draft.claude.credentialRef = 'dev.cutroom.app/anthropic-api-key'; }
          if (provider === 'openai') draft.openai.apiKeyRef = 'dev.cutroom.app/openai-api-key';
          if (provider === 'elevenlabs') draft.elevenLabs.apiKeyRef = 'dev.cutroom.app/elevenlabs-api-key';
        });
        this.details.set(provider, result.detail); this.emit(); return this.info(provider);
      } finally { key = ''; parsed.data.apiKey = ''; }
    });
  }
  disconnect(provider: Provider): Promise<AccountInfo> {
    providerSchema.parse(provider);
    return this.exclusive(provider, async () => {
      const settings = this.options.settings.get();
      const hasKey = provider === 'anthropic' ? settings.claude.credentialRef : provider === 'openai' ? settings.openai.apiKeyRef : settings.elevenLabs.apiKeyRef;
      if (hasKey) await this.options.secrets.delete(provider);
      await this.options.settings.update((draft) => {
        draft.accounts[provider] = { keyPreview: null, checkedAt: null, status: 'not_connected' };
        if (provider === 'anthropic') delete draft.claude.credentialRef;
        if (provider === 'openai') delete draft.openai.apiKeyRef;
        if (provider === 'elevenlabs') { delete draft.elevenLabs.apiKeyRef; delete draft.elevenLabs.oauthRef; }
      });
      this.details.delete(provider); this.emit(); return this.info(provider);
    });
  }
  verify(provider: Provider): Promise<AccountInfo> { providerSchema.parse(provider); return this.exclusive(provider, () => this.verifyUnlocked(provider)); }
  private async verifyUnlocked(provider: Provider): Promise<AccountInfo> {
    const settings = this.options.settings.get();
    if (provider === 'anthropic' && settings.claude.auth === 'claude-code') {
      const status = await this.options.claudeCode.status();
      const detail = status.loggedIn ? `Signed in with Claude Code${status.email ? ` · ${status.email}` : ''}` : 'Sign in with Claude Code in Terminal.';
      await this.options.settings.update((draft) => { draft.accounts.anthropic = { status: status.loggedIn ? 'connected' : 'not_connected', keyPreview: null, checkedAt: new Date().toISOString() }; });
      this.details.set(provider, detail); this.emit(); return this.info(provider);
    }
    let key: string | null = null;
    try {
      key = await this.options.secrets.get(provider);
      const result = key ? await this.checkKey(provider, key) : null;
      await this.options.settings.update((draft) => { draft.accounts[provider] = { ...draft.accounts[provider], status: result?.status ?? 'not_connected', keyPreview: key ? `…${key.slice(-4)}` : null, checkedAt: new Date().toISOString() }; });
      this.details.set(provider, result?.detail ?? null);
    } catch {
      await this.options.settings.update((draft) => { draft.accounts[provider].status = 'unreachable'; draft.accounts[provider].checkedAt = new Date().toISOString(); });
      this.details.set(provider, 'The macOS Keychain is unavailable. Unlock it and retry.');
    } finally { key = null; }
    this.emit(); return this.info(provider);
  }
  setMethod(method: 'api-key' | 'claude-code'): Promise<AccountInfo> {
    accountMethodSchema.parse(method);
    return this.exclusive('anthropic', async () => {
      if (method === 'claude-code') {
        const status = await this.options.claudeCode.status();
        if (!status.loggedIn) throw new IpcFailure({ code: 'invalid_request', message: 'Sign in with Claude Code in Terminal first, then check again.' });
        await this.options.settings.update((draft) => { draft.claude.auth = method; draft.accounts.anthropic = { status: 'connected', keyPreview: null, checkedAt: new Date().toISOString() }; });
        this.details.set('anthropic', `Signed in with Claude Code${status.email ? ` · ${status.email}` : ''}`); this.emit(); return this.info('anthropic');
      }
      await this.options.settings.update((draft) => { draft.claude.auth = method; draft.accounts.anthropic = { keyPreview: null, checkedAt: null, status: 'not_connected' }; });
      if (this.options.settings.get().claude.credentialRef) return this.verifyUnlocked('anthropic');
      this.details.delete('anthropic'); this.emit(); return this.info('anthropic');
    });
  }
  async verifyConnected(): Promise<void> { await Promise.all(this.list().filter((account) => account.status === 'connected').map((account) => this.verify(account.provider).catch(() => undefined))); }
  async getApiKey(provider: Provider): Promise<string | null> { providerSchema.parse(provider); return this.options.secrets.get(provider); }
  async close(): Promise<void> { this.closed = true; for (const controller of this.active) controller.abort(); await Promise.all([...this.queues.values()]); }
}
