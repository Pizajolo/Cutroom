import path from 'node:path';
import { IpcFailure, type InvokeReq } from '@shared/ipc/contract';
import { BUILTIN_EXTENSION_IDS, extensionConfigSchema, type ExtensionConfig, type ExtensionInfo } from '@shared/schema/extensions';
import type { ExtensionSecretStore } from '../secrets/keychain';
import type { SettingsStore } from './store';

export const BUILTIN_EXTENSIONS: readonly ExtensionConfig[] = [
  { id: 'cutroom', name: 'Cutroom editor', enabled: true, transport: 'stdio', command: '/builtin/cutroom', args: [] },
  { id: 'elevenlabs', name: 'ElevenLabs audio', enabled: true, transport: 'stdio', command: '/builtin/elevenlabs', args: [] },
  { id: 'codex', name: 'Codex', enabled: false, transport: 'stdio', command: '/builtin/codex', args: [] },
  { id: 'elevenlabs-hosted', name: 'ElevenLabs hosted MCP', enabled: false, transport: 'http', url: 'https://api.elevenlabs.io/v1/mcp' },
];
const builtin = (id: string): boolean => (BUILTIN_EXTENSION_IDS as readonly string[]).includes(id);
const dangerousEnv = (name: string): boolean => ['PATH', 'HOME', 'USERPROFILE', 'SHELL', 'BASH_ENV', 'ENV', 'NODE_OPTIONS', 'NODE_PATH'].includes(name) || /^(DYLD_|LD_|ELECTRON_)/.test(name);
export class ExtensionsService {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private readonly options: { store: SettingsStore; secrets: ExtensionSecretStore; changed: () => void; status?: (id: string) => Promise<Pick<ExtensionInfo, 'status' | 'detail'>> }) {}
  private exclusive<T>(action: () => Promise<T>): Promise<T> { const value = this.pending.then(action); this.pending = value.catch(() => undefined); return value; }
  enabled(id: string): boolean { return this.options.store.get().extensions.find((entry) => entry.config.id === id)?.config.enabled ?? BUILTIN_EXTENSIONS.find((entry) => entry.id === id)?.enabled ?? false; }
  async list(): Promise<ExtensionInfo[]> {
    const saved = this.options.store.get().extensions;
    const configs = [...BUILTIN_EXTENSIONS.map((config) => saved.find((entry) => entry.config.id === config.id)?.config ?? config), ...saved.filter((entry) => !builtin(entry.config.id)).map((entry) => entry.config)];
    return Promise.all(configs.map(async (config) => {
      const status = !config.enabled ? { status: 'disabled' as const, detail: null } : await this.options.status?.(config.id) ?? { status: 'unavailable' as const, detail: 'Configured. Assistant execution is not available yet.' };
      return { config: structuredClone(config), builtin: builtin(config.id), secretEnvNames: Object.keys(saved.find((entry) => entry.config.id === config.id)?.secretEnvRefs ?? {}), ...status };
    }));
  }
  validate(input: ExtensionConfig) {
    const config = extensionConfigSchema.parse(input);
    if (config.transport === 'http') { const url = new URL(config.url); if (url.protocol !== 'https:' || url.username || url.password) throw new IpcFailure({ code: 'invalid_request', message: 'HTTP MCP extensions require HTTPS without embedded credentials.' }); return { commandPreview: `HTTPS ${url.href}`, domains: [url.hostname], scopes: ['The remote MCP server receives the tool inputs you approve. Server-side filesystem access is controlled by its operator.'] }; }
    if (!path.isAbsolute(config.command) || [...config.command].some((char) => char.charCodeAt(0) < 32)) throw new IpcFailure({ code: 'invalid_request', message: 'Choose an absolute executable path for a stdio MCP extension.' });
    return { commandPreview: [config.command, ...config.args].map((value) => JSON.stringify(value)).join(' '), domains: [], scopes: ['Custom stdio servers run as your user. They are not confined by the editor file-write hooks; only enable servers you trust.', 'Network access is controlled by the server, not by Cutroom editor permissions.'] };
  }
  add(request: InvokeReq<'extensions.add'>): Promise<ExtensionInfo> { return this.exclusive(async () => {
    const config = extensionConfigSchema.parse(request.config); this.validate(config);
    if (builtin(config.id)) throw new IpcFailure({ code: 'forbidden', message: 'Built-in extension definitions cannot be replaced. Use the enabled toggle.' });
    if (this.options.store.get().extensions.some((entry) => entry.config.id === config.id)) throw new IpcFailure({ code: 'conflict', message: 'An extension with this id already exists.' });
    const env = request.secretEnv ?? {}; if (Object.keys(env).some(dangerousEnv)) throw new IpcFailure({ code: 'forbidden', message: 'Runtime loader, executable search and home-directory environment overrides are not allowed.' });
    const written: string[] = [];
    try {
      for (const [name, value] of Object.entries(env)) { await this.options.secrets.setExtension(config.id, name, value); written.push(name); }
      await this.options.store.update((draft) => { draft.extensions.push({ config, secretEnvRefs: Object.fromEntries(written.map((name) => [name, `dev.cutroom.app/ext-${config.id}-${name}`])) }); });
    } catch (error) { await Promise.allSettled(written.map((name) => this.options.secrets.deleteExtension(config.id, name))); throw error; }
    this.options.changed(); return (await this.list()).find((entry) => entry.config.id === config.id)!;
  }); }
  remove(id: string): Promise<{ ok: true }> { return this.exclusive(async () => {
    if (builtin(id)) throw new IpcFailure({ code: 'forbidden', message: 'Built-in extensions can be disabled, not removed.' });
    const entry = this.options.store.get().extensions.find((entry) => entry.config.id === id); if (!entry) throw new IpcFailure({ code: 'not_found', message: 'Extension not found.' });
    await this.options.store.update((draft) => { draft.extensions = draft.extensions.filter((entry) => entry.config.id !== id); });
    await Promise.all(Object.keys(entry.secretEnvRefs).map((name) => this.options.secrets.deleteExtension(id, name))); this.options.changed(); return { ok: true };
  }); }
  setEnabled(id: string, enabled: boolean): Promise<ExtensionInfo> { return this.exclusive(async () => {
    const config = (await this.list()).find((entry) => entry.config.id === id)?.config; if (!config) throw new IpcFailure({ code: 'not_found', message: 'Extension not found.' });
    await this.options.store.update((draft) => { const saved = draft.extensions.find((entry) => entry.config.id === id); if (saved) saved.config.enabled = enabled; else draft.extensions.push({ config: { ...config, enabled }, secretEnvRefs: {} }); });
    this.options.changed(); return (await this.list()).find((entry) => entry.config.id === id)!;
  }); }
}
