// Browser-only fixture. Never imported by the production renderer or preload.
// No provider requests, Keychain access, Terminal launch, or real downloads occur.
import { createRoot } from 'react-dom/client';
import { contract, type EventName, type EventPayload, type InvokeChannel, type InvokeRes } from '../../../src/shared/ipc';
import type { AccountInfo, ClaudeCodeStatus } from '../../../src/shared/schema/accounts';
import type { ToolInfo } from '../../../src/shared/schema/media';
import type { WhisperModelInfo } from '../../../src/shared/schema/models';
import { App } from '../../../src/renderer/App';
import { useNavigation, SETTINGS_SECTIONS } from '../../../src/renderer/state/navigation';
import { useAssistant } from '../../../src/renderer/editor/assistantStore';
import { defaultGlobalSettings } from '../../../src/shared/schema/settings';
import { session, timelineDoc, preset } from '../fixtures';
import '../../../src/renderer/styles/tokens.css';
import '../../../src/renderer/styles/app.css';

const listeners = new Map<string, Set<(value: unknown) => void>>();
const emit = (event: EventName, value: unknown) => listeners.get(event)?.forEach((listener) => listener(value));
let accounts: AccountInfo[] = (['anthropic', 'openai', 'elevenlabs'] as const).map((provider) => ({ provider, status: 'not_connected', method: null, keyPreview: null, detail: null, checkedAt: null }));
let tools: ToolInfo[] = ['ffmpeg', 'ffprobe', 'yt-dlp', 'whisper-cli'].map((name) => ({ name, version: name === 'yt-dlp' ? '2026.10.30' : '7.1', path: '', source: 'downloaded', status: name === 'whisper-cli' ? 'missing' : 'ok', verification: name === 'whisper-cli' ? null : 'pinned', install: null, updatable: name === 'yt-dlp', latestVersion: null, hint: name === 'whisper-cli' ? 'Build whisper-cli with cmake and Xcode Command Line Tools.' : null }));
let models: WhisperModelInfo[] = [
  { name: 'base', sizeBytes: 148_000_000, status: 'installed', install: null, isDefault: true },
  { name: 'small', sizeBytes: 488_000_000, status: 'missing', install: null, isDefault: false },
  { name: 'medium', sizeBytes: 1_530_000_000, status: 'checksum_mismatch', install: null, isDefault: false },
  { name: 'large-v3-turbo', sizeBytes: 1_620_000_000, status: 'missing', install: null, isDefault: false },
];
let settings = defaultGlobalSettings();
const project = new URLSearchParams(location.search).has('project') ? session : null;
const extensions = ['cutroom', 'elevenlabs', 'codex', 'elevenlabs-hosted'].map((id) => ({ config: { id, name: id === 'cutroom' ? 'Cutroom editor' : id === 'elevenlabs' ? 'ElevenLabs' : id === 'codex' ? 'Codex' : 'ElevenLabs hosted MCP', enabled: id === 'cutroom', transport: 'stdio', command: '/fixture/builtin', args: [] }, builtin: true, secretEnvNames: [], status: id === 'cutroom' ? 'ready' : 'disabled', detail: null }));
let loggedIn = false;
const status = (): ClaudeCodeStatus => ({ available: true, loggedIn, email: loggedIn ? 'editor@example.test' : null, organization: null, cliVersion: '2.1', binarySource: 'installed', authMethod: loggedIn ? 'claude.ai' : 'none' });
window.cutroom = {
  async invoke<C extends InvokeChannel>(channel: C, request: unknown) {
    contract.invoke[channel].req.parse(request);
    const req = request as { provider?: AccountInfo['provider']; name?: string; patch?: Record<string, unknown>; config?: unknown; id?: string; enabled?: boolean };
    let response: unknown;
    if (channel === 'app.getInfo') response = { version: '0.1.0-fixture', platform: 'darwin', arch: 'arm64', homeDir: '/fixture', mediaBaseUrl: null, compBaseUrl: null };
    else if (channel === 'project.current') response = project;
    else if (channel === 'project.retryFootageImport') response = session;
    else if (channel === 'agent.respondPermission') response = { ok: true };
    else if (channel === 'project.listRecent') response = project ? [{ id: session.project.id, name: session.project.name, rootPath: session.rootPath, format: session.project.format, lastOpenedAt: session.project.createdAt, missing: false }] : [];
    else if (channel === 'settings.get') response = settings;
    else if (channel === 'settings.update') { settings = { ...settings, ...req.patch }; response = settings; emit('settings.changed', settings); }
    else if (['jobs.list', 'snapshots.list', 'media.list', 'audio.voices', 'compositions.templates'].includes(channel)) response = [];
    else if (channel === 'timeline.get') response = { doc: timelineDoc(), revision: 1, canUndo: false, canRedo: false };
    else if (channel === 'export.presets') response = [preset];
    else if (channel === 'export.preflight') response = { canExport: false, blockers: ['This browser fixture has no playable media.'], unsupportedItems: [] };
    else if (channel === 'storage.usage') response = { totalBytes: 4000000, categories: [{ category: 'thumbnails', bytes: 4000000, items: 2 }] };
    else if (channel === 'storage.cleanPreview') response = { token: 'fixture-preview', bytes: 4000000, items: [{ rel: 'work/.cutroom-media/thumbs.jpg', bytes: 4000000, category: 'thumbnails' }] };
    else if (channel === 'storage.clean') response = { ok: true };
    else if (channel === 'extensions.list') response = extensions;
    else if (channel === 'extensions.validate') response = { commandPreview: JSON.stringify(req.config), domains: [], scopes: ['Runs as your user. Browser fixture only; never executed.'] };
    else if (channel === 'extensions.setEnabled') { const extension = extensions.find((e) => e.config.id === req.id); if (extension) { extension.config.enabled = !!req.enabled; extension.status = req.enabled ? 'ready' : 'disabled'; } response = extension; }
    else if (channel === 'accounts.codex.status') response = { available: true, loggedIn, mode: loggedIn ? 'chatgpt' : null };
    else if (channel === 'accounts.codex.openLogin') { window.setTimeout(() => { loggedIn = true; }, 4000); response = { ok: true }; }
    else if (channel === 'accounts.list') response = accounts;
    else if (channel === 'tools.list') response = tools;
    else if (channel === 'models.list') response = models;
    else if (channel === 'accounts.claudeCode.status') response = status();
    else if (channel === 'accounts.claudeCode.openLogin') { window.setTimeout(() => { loggedIn = true; }, 4000); response = { ok: true }; }
    else if (channel === 'accounts.connectKey' || channel === 'accounts.claude.setMethod' || channel === 'accounts.disconnect' || channel === 'accounts.verify') {
      const provider = channel === 'accounts.claude.setMethod' ? 'anthropic' : req.provider;
      accounts = accounts.map((account) => account.provider !== provider ? account : { ...account, status: channel === 'accounts.disconnect' ? 'not_connected' : 'connected', method: channel === 'accounts.disconnect' ? null : channel === 'accounts.claude.setMethod' ? 'claude-code' : 'api-key', keyPreview: channel === 'accounts.disconnect' || channel === 'accounts.claude.setMethod' ? null : '…demo', checkedAt: new Date().toISOString(), detail: channel === 'accounts.disconnect' ? null : provider === 'elevenlabs' ? 'Creator plan · 24,800 of 100,000 characters used (fixture)' : channel === 'accounts.claude.setMethod' ? 'Signed in with Claude Code (editor@example.test)' : 'Connected (simulated service)' });
      response = accounts.find((account) => account.provider === provider); emit('accounts.changed', accounts);
    } else if (channel === 'tools.checkUpdate') {
      tools = tools.map((tool) => tool.name === req.name ? { ...tool, latestVersion: '2026.11.01' } : tool);
      response = { current: '2026.10.30', latest: '2026.11.01' }; emit('tools.changed', tools);
    } else if (channel === 'tools.install' || channel === 'tools.update') {
      tools = tools.map((tool) => tool.name === req.name ? { ...tool, install: { state: 'downloading', received: 0, total: 58_000_000 } } : tool);
      response = { ok: true }; emit('tools.changed', tools);
    } else if (channel === 'tools.cancelInstall') {
      tools = tools.map((tool) => tool.name === req.name ? { ...tool, install: null } : tool); response = { ok: true }; emit('tools.changed', tools);
    } else if (channel.startsWith('models.')) {
      models = models.map((model) => channel === 'models.setDefault' ? { ...model, isDefault: model.name === req.name } : model.name !== req.name ? model : channel === 'models.download' ? { ...model, install: { state: 'downloading', received: 0, total: model.sizeBytes } } : { ...model, install: null, status: channel === 'models.delete' ? 'missing' : model.status });
      response = channel === 'models.setDefault' ? models : { ok: true }; emit('models.changed', models);
    } else return { ok: false, error: { code: 'unavailable', message: 'Not part of this browser fixture.' } };
    return { ok: true, data: contract.invoke[channel].res.parse(response) as InvokeRes<C> };
  },
  on<E extends EventName>(event: E, callback: (payload: EventPayload<E>) => void) {
    const listener = (value: unknown) => callback(contract.events[event].parse(value) as EventPayload<E>);
    const group = listeners.get(event) ?? new Set(); group.add(listener); listeners.set(event, group);
    return () => { group.delete(listener); };
  },
  getPathForFile: () => '',
};
window.setInterval(() => {
  tools = tools.map((tool) => !tool.install ? tool : tool.install.received >= (tool.install.total ?? Infinity) ? { ...tool, install: null, status: 'ok', version: tool.latestVersion ?? tool.version, source: tool.latestVersion ? 'updated' : 'downloaded', verification: tool.latestVersion ? 'upstream' : 'pinned', latestVersion: null } : { ...tool, install: { ...tool.install, received: tool.install.received + 4_000_000 } });
  models = models.map((model) => !model.install ? model : model.install.received >= (model.install.total ?? Infinity) ? { ...model, install: null, status: 'installed' } : { ...model, install: { ...model.install, received: model.install.received + 12_000_000 } });
  emit('tools.changed', tools); emit('models.changed', models);
}, 1000);
const requested = new URLSearchParams(location.search).get('section');
useNavigation.setState({ destination: new URLSearchParams(location.search).has('editor') ? 'project' : new URLSearchParams(location.search).has('home') ? 'home' : 'settings', project, settingsSection: SETTINGS_SECTIONS.find((section) => section === requested) ?? 'Accounts' });
const review = new URLSearchParams(location.search).get('review');
if (project && review === 'permissions') {
  useNavigation.setState({ dock: 'Assistant' });
  useAssistant.setState({ sessionId: 'fixture-agent', status: 'waiting_permission', messages: [{ role: 'assistant', text: 'Simulated permission review. No command will run.' }] });
  useAssistant.getState().receive({ type: 'permission_request', sessionId: 'fixture-agent', requestId: 'fixture-permission', tool: 'Bash', description: 'Allow Bash for this request?', input: { command: 'ffmpeg -i "raw/coast.mp4" "work/preview.mov"', cwd: 'work/', env: { API_KEY: 'fixture-secret-not-shown' } } });
}
if (project && review === 'import-recovery') useNavigation.setState({ importRecovery: { ...project, importWarning: { message: 'Simulated copy failure: one footage file could not be read.', completed: 1, total: 3, retryId: 'fixture-retry' } } });
createRoot(document.getElementById('root')!).render(<App />);
