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
import { session, timelineDoc, preset, media } from '../fixtures';
import { applyOps } from '../../../src/shared/timeline/ops';
import type { TimelineDoc } from '../../../src/shared/schema/timeline';
import type { VideoSkillDetail } from '../../../src/shared/schema/skills';
import '../../../src/renderer/styles/tokens.css';
import '../../../src/renderer/styles/app.css';

const listeners = new Map<string, Set<(value: unknown) => void>>();
const emit = (event: EventName, value: unknown) => listeners.get(event)?.forEach((listener) => listener(value));
let accounts: AccountInfo[] = (['anthropic', 'openai', 'elevenlabs'] as const).map((provider) => ({ provider, status: 'not_connected', method: null, keyPreview: null, detail: null, checkedAt: null }));
let tools: ToolInfo[] = ['ffmpeg', 'ffprobe', 'yt-dlp', 'whisper-cli'].map((name) => ({ name, version: name === 'yt-dlp' ? '2026.10.30' : '7.1', path: '', source: 'downloaded', status: name === 'whisper-cli' ? 'missing' : 'ok', verification: name === 'whisper-cli' ? null : 'pinned', install: null, updatable: name === 'yt-dlp', latestVersion: null, action: null, hint: name === 'whisper-cli' ? 'Build whisper-cli with cmake and Xcode Command Line Tools.' : null }));
let models: WhisperModelInfo[] = [
  { name: 'base', sizeBytes: 148_000_000, status: 'installed', install: null, isDefault: true },
  { name: 'small', sizeBytes: 488_000_000, status: 'missing', install: null, isDefault: false },
  { name: 'medium', sizeBytes: 1_530_000_000, status: 'checksum_mismatch', install: null, isDefault: false },
  { name: 'large-v3-turbo', sizeBytes: 1_620_000_000, status: 'missing', install: null, isDefault: false },
];
let settings = defaultGlobalSettings();
let doc = timelineDoc(), revision = 1;
const past: TimelineDoc[] = [], future: TimelineDoc[] = [];
const picture = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900"><rect width="1600" height="900" fill="#7797a1"/><path d="M0 440Q500 300 1600 500V900H0Z" fill="#3e6977"/><path d="M1600 300Q1120 400 980 610T400 900H1600Z" fill="#a4aa8b"/><path d="M1600 390Q1210 440 1100 650T650 900H1600Z" fill="#424f47"/></svg>')}`;
const fixtureMedia = { ...media, rel: 'raw/coastline.svg', name: 'coastline.svg', kind: 'image' as const, url: picture };
const first = doc.tracks.find((t) => t.id === 'video')!.items[0]!;
if (first.type === 'clip') first.src = fixtureMedia.rel;
if (new URLSearchParams(location.search).has('long')) doc.tracks.find((t) => t.id === 'video')!.items = Array.from({ length: 200 }, (_, index) => ({ ...first, id: `clip_${String(index).padStart(10, '0')}`, start: index * 6 }));
const timelineState = () => ({ doc, revision, canUndo: !!past.length, canRedo: !!future.length });
let skills: VideoSkillDetail[] = [
  ['talking-head', 'Talking-head short'], ['product-teaser', 'Product teaser'], ['explainer', 'YouTube explainer'], ['podcast-clip', 'Podcast clip'],
].map(([id, name]) => ({ id: id!, name: name!, description: 'A reusable video structure with titles, footage and captions.', source: 'builtin', compositions: [], updatedAt: '2026-11-08T00:00:00.000Z', instructions: 'Use the selected video structure. Ask for missing content before editing.' }));
const skillList = () => skills.map((s) => ({ id: s.id, name: s.name, description: s.description, source: s.source, compositions: s.compositions, updatedAt: s.updatedAt }));
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
    else if (channel === 'agent.start') response = { sessionId: 'fixture-agent' };
    else if (channel === 'agent.send') {
      const send = contract.invoke['agent.send'].req.parse(request);
      window.setTimeout(() => { emit('agent.event', { type: 'message', sessionId: send.sessionId, role: 'assistant', text: `Browser fixture received your message${send.skillId ? ` with video type ${send.skillId}` : ''}. No provider request was made.` }); emit('agent.event', { type: 'result', sessionId: send.sessionId, inputTokens: 0, outputTokens: 0 }); }, 250);
      response = { ok: true };
    }
    else if (channel === 'agent.interrupt') { emit('agent.event', { type: 'status', sessionId: 'fixture-agent', status: 'interrupted' }); response = { ok: true }; }
    else if (channel === 'agent.respondQuestion' || channel === 'agent.respondPermission') { response = { ok: true }; window.setTimeout(() => emit('agent.event', { type: 'result', sessionId: 'fixture-agent', inputTokens: 0, outputTokens: 0 }), 100); }
    else if (channel === 'project.listRecent') response = project ? [{ id: session.project.id, name: session.project.name, rootPath: session.rootPath, format: session.project.format, lastOpenedAt: session.project.createdAt, missing: false }] : [];
    else if (channel === 'settings.get') response = settings;
    else if (channel === 'settings.update') { settings = { ...settings, ...req.patch }; response = settings; emit('settings.changed', settings); }
    else if (channel === 'skills.list') response = skillList();
    else if (channel === 'skills.get') response = skills.find((s) => s.id === req.id);
    else if (channel === 'skills.save') {
      const saved = contract.invoke['skills.save'].req.parse(request);
      const value: VideoSkillDetail = { ...saved, id: saved.id ?? 'fixture-skill', source: 'user', compositions: [], updatedAt: new Date().toISOString() };
      skills = [...skills.filter((s) => s.id !== value.id), value]; response = value; emit('skills.changed', skillList());
    }
    else if (channel === 'skills.delete') { skills = skills.filter((s) => s.id !== req.id); response = { ok: true }; emit('skills.changed', skillList()); }
    else if (['timeline.history', 'jobs.list', 'snapshots.list', 'audio.voices', 'compositions.templates'].includes(channel)) response = [];
    else if (channel === 'media.list') response = [fixtureMedia];
    else if (channel === 'media.thumbnails') response = { imageRel: 'work/coastline.svg', imageUrl: picture, interval: 1, frameWidth: 1600, frameHeight: 900, columns: 1, rows: 1, count: 1, frames: [{ time: 0, x: 0, y: 0, w: 1600, h: 900 }] };
    else if (channel === 'timeline.get') response = timelineState();
    else if (channel === 'timeline.apply') {
      const edit = contract.invoke['timeline.apply'].req.parse(request);
      const result = applyOps(doc, edit.ops, { sourceDurations: { [fixtureMedia.rel]: 12.51 } });
      past.push(doc); future.length = 0; doc = result.doc; revision++; response = timelineState();
    }
    else if (channel === 'timeline.undo' || channel === 'timeline.redo') {
      const source = channel === 'timeline.undo' ? past : future, target = channel === 'timeline.undo' ? future : past;
      const previous = source.pop(); if (previous) { target.push(doc); doc = previous; revision++; } response = timelineState();
    }
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
  tools = tools.map((tool) => !tool.install ? tool : tool.install.received >= (tool.install.total ?? Infinity) ? { ...tool, install: null, status: 'ok', version: tool.latestVersion ?? tool.version, source: tool.latestVersion ? 'updated' : 'downloaded', verification: tool.install.state === 'building' ? 'built' : tool.latestVersion ? 'upstream' : 'pinned', latestVersion: null } : { ...tool, install: { ...tool.install, received: tool.install.received + (tool.install.state === 'building' ? 2 : 4_000_000) } });
  models = models.map((model) => !model.install ? model : model.install.received >= (model.install.total ?? Infinity) ? { ...model, install: null, status: 'installed' } : { ...model, install: { ...model.install, received: model.install.received + 12_000_000 } });
  emit('tools.changed', tools); emit('models.changed', models);
}, 1000);
const requested = new URLSearchParams(location.search).get('section');
useNavigation.setState({ destination: new URLSearchParams(location.search).has('editor') ? 'project' : new URLSearchParams(location.search).has('home') ? 'home' : 'settings', project, settingsSection: SETTINGS_SECTIONS.find((section) => section === requested) ?? 'Accounts' });
const review = new URLSearchParams(location.search).get('review');
if (project && review === 'permissions') {
  useNavigation.setState({ chatCollapsed: false });
  useAssistant.setState({ sessionId: 'fixture-agent', status: 'waiting_permission', messages: [{ role: 'assistant', text: 'Simulated permission review. No command will run.' }] });
  useAssistant.getState().receive({ type: 'permission_request', rememberable: true, sessionId: 'fixture-agent', requestId: 'fixture-permission', tool: 'Bash', description: 'Allow Bash for this request?', input: { command: 'ffmpeg -i "raw/coast.mp4" "work/preview.mov"', cwd: 'work/', env: { API_KEY: 'fixture-secret-not-shown' } } });
}
if (project && review === 'questions') {
  useAssistant.setState({ sessionId: 'fixture-agent', messages: [{ role: 'assistant', text: 'Before I create the video, I need a little more direction. This is a simulated question, not a provider request.' }] });
  useAssistant.getState().receive({ type: 'question_request', sessionId: 'fixture-agent', requestId: 'fixture-question', questions: [
    { question: 'Who is the video for?', header: 'Audience', multiSelect: false, options: [{ label: 'New customers', description: 'Explain the product clearly.' }, { label: 'Existing customers', description: 'Show what has changed.' }] },
    { question: 'What should I include?', header: 'Content', multiSelect: true, options: [{ label: 'Titles', description: '' }, { label: 'Voiceover', description: '' }] },
  ] });
}
if (new URLSearchParams(location.search).has('building')) tools = tools.map((tool) => tool.name === 'whisper-cli' ? { ...tool, hint: null, install: { state: 'building', received: 42, total: 100 } } : tool);
if (project && review === 'import-recovery') useNavigation.setState({ importRecovery: { ...project, importWarning: { message: 'Simulated copy failure: one footage file could not be read.', completed: 1, total: 3, retryId: 'fixture-retry' } } });
createRoot(document.getElementById('root')!).render(<App />);
