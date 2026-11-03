import { act, cleanup, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { defaultGlobalSettings } from '@shared/schema/settings';
import { IpcFailure } from '@shared/ipc';
import { ProjectDialog, Projects } from '../../src/renderer/pages/Projects';
import { WorkspaceSettings } from '../../src/renderer/pages/WorkspaceSettings';
import { ExtensionsSettings } from '../../src/renderer/pages/ExtensionsSettings';
import { SettingsLeaveDialog } from '../../src/renderer/components/SettingsLeaveDialog';
import { ExportDialog } from '../../src/renderer/editor/ExportDialog';
import { UrlImportDialog } from '../../src/renderer/media/UrlImportDialog';
import { Assistant, AskDialog } from '../../src/renderer/editor/Assistant';
import { useAssistant } from '../../src/renderer/editor/assistantStore';
import { useEditor, addMedia, addText, mediaItem } from '../../src/renderer/editor/store';
import { useSelection } from '../../src/renderer/editor/selection/store';
import { previewClock } from '../../src/renderer/editor/preview/store';
import { useNavigation } from '../../src/renderer/state/navigation';
import { useSettingsGuard } from '../../src/renderer/state/settingsDraft';
import { Home } from '../../src/renderer/pages/Home';
import { CodexSignIn } from '../../src/renderer/pages/CodexSignIn';
import { AudioDock } from '../../src/renderer/editor/AudioDock';
import { VoiceButton } from '../../src/renderer/components/VoiceButton';
import { TranscriptDock } from '../../src/renderer/editor/TranscriptDock';
import { Inspector } from '../../src/renderer/editor/Inspector';
import { Timeline } from '../../src/renderer/editor/timeline/Timeline';
import { keymap } from '../../src/renderer/lib/keymap';
import { MEDIA_DRAG_TYPE } from '../../src/renderer/media/types';
import { MediaBrowser } from '../../src/renderer/media/MediaBrowser';
import { JobsIndicator } from '../../src/renderer/components/Jobs';
import { App } from '../../src/renderer/App';
import { CompositionLayers, CompositionPicker, compositionUrl, overlayProps } from '../../src/renderer/editor/compositions';
import { defaultReply, media, preset, session, timelineDoc } from './fixtures';
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listeners: new Map<string, (payload: unknown) => void>() }));
vi.mock('../../src/renderer/lib/api', () => ({ api: { invoke: mocks.invoke, on: (event: string, receive: (payload: unknown) => void) => { mocks.listeners.set(event, receive); return () => mocks.listeners.delete(event); } } }));
const originalArrayBuffer = Object.getOwnPropertyDescriptor(Blob.prototype, 'arrayBuffer');
const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
let replies: Record<string, unknown>;
const state = () => ({ doc: timelineDoc(), revision: 2, canUndo: true, canRedo: false });
const account = { provider: 'anthropic', status: 'connected', method: 'claude-code', keyPreview: null, detail: null, checkedAt: null };
const job = { id: 'job1', kind: 'export', label: 'Coast export', projectId: 'coast', phase: 'Queued', createdAt: '2026-11-01T00:00:00.000Z', finishedAt: null, status: 'queued', progress: 0, logPath: 'work/logs/export.log' };
beforeEach(() => {
  mocks.invoke.mockReset(); mocks.listeners.clear(); replies = {};
  mocks.invoke.mockImplementation(async (channel: string) => channel in replies ? replies[channel] : defaultReply(channel));
  useSettingsGuard.setState({ guard: null, pending: null, busy: false });
  useNavigation.setState({ project: null, destination: 'home', tab: 'Editor', projectDialog: null, projectBusy: false, projectError: null, recentProjects: [], loadingProjects: false, dock: 'Inspector', goalDraft: '' });
  useEditor.setState({ timeline: null, media: [], pending: false, error: null });
  useAssistant.setState({ sessionId: null, status: 'idle', messages: [], permissions: [], tools: [], changes: [], cost: null, sending: false, draft: '', error: null });
  useSelection.getState().clear(); previewClock.configure(20, 30); previewClock.seek(0);
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(() => {
  cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); useSettingsGuard.setState({ guard: null, pending: null }); keymap.setScopes([]);
  if (originalArrayBuffer) Object.defineProperty(Blob.prototype, 'arrayBuffer', originalArrayBuffer); else Reflect.deleteProperty(Blob.prototype, 'arrayBuffer');
  if (originalMediaDevices) Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices); else Reflect.deleteProperty(navigator, 'mediaDevices');
});

it('creates a project with an opaque folder grant, never a display path', async () => {
  replies['dialog.pickFolder'] = { grantId: 'grant-parent', displayPath: '/fixture/parent' }; replies['project.create'] = session;
  useNavigation.setState({ projectDialog: 'new' }); render(<ProjectDialog />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Coast' } });
  fireEvent.click(screen.getByRole('button', { name: 'Choose location' })); await screen.findByText('/fixture/parent');
  fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
  await waitFor(() => expect(useNavigation.getState().project).toEqual(session));
  expect(mocks.invoke).toHaveBeenCalledWith('dialog.pickFolder', { purpose: 'projectParent' });
  const request = mocks.invoke.mock.calls.find(([c]) => c === 'project.create')?.[1];
  expect(request).toMatchObject({ parentGrant: 'grant-parent', format: { width: 1920, height: 1080, fps: 30 } });
  expect(JSON.stringify(request)).not.toContain('/fixture'); expect(useNavigation.getState().tab).toBe('Editor');
});
it('requires explicit create-in-place confirmation and refreshes actual recents', async () => {
  replies['dialog.pickFolder'] = { grantId: 'grant-root', displayPath: session.rootPath };
  replies['project.open'] = { status: 'needsCreate', grantId: 'grant-root', displayPath: session.rootPath, looseMediaCount: 3 };
  replies['project.createInPlace'] = session;
  replies['project.listRecent'] = [{ id: session.project.id, name: 'Coast', rootPath: session.rootPath, format: session.project.format, lastOpenedAt: session.project.createdAt, missing: false }];
  await useNavigation.getState().pickProject(); render(<ProjectDialog />);
  expect(screen.getByText('Found 3 media files in the folder root.')).toBeTruthy();
  expect(mocks.invoke.mock.calls.some(([c]) => c === 'project.createInPlace')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Create project here' }));
  await waitFor(() => expect(useNavigation.getState().recentProjects).toHaveLength(1));
  expect(mocks.invoke).toHaveBeenCalledWith('project.createInPlace', expect.objectContaining({ grantId: 'grant-root' }));
});
it('keeps missing projects visible with disabled Open and Remove from list', async () => {
  useNavigation.setState({ recentProjects: [{ id: 'missing', name: 'Missing edit', rootPath: '/fixture/missing', format: session.project.format, lastOpenedAt: session.project.createdAt, missing: true }] });
  render(<Projects />); expect((screen.getByRole('button', { name: 'Open' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Remove from list' })); await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('project.removeRecent', { id: 'missing' }));
});
it('adds media through one revision-checked video addItem and never exceeds source duration', async () => {
  useEditor.setState({ timeline: state() }); await addMedia(media);
  expect(mocks.invoke).toHaveBeenCalledWith('timeline.apply', expect.objectContaining({ baseRevision: 2, ops: [expect.objectContaining({ type: 'addItem', trackId: 'video', item: expect.objectContaining({ src: media.rel, start: 5 }) })] }));
  const item = mediaItem(media, 1.011, 30); expect(item.start).toBe(1); expect(item.duration).toBeLessThanOrEqual(media.probe!.duration);
});
it('refetches stale revisions without losing selection', async () => {
  useEditor.setState({ timeline: state() }); useSelection.getState().select({ itemId: 'clip_0000000001' });
  mocks.invoke.mockImplementation(async (channel: string) => { if (channel === 'timeline.apply') throw new IpcFailure({ code: 'conflict', message: 'Stale revision' }); return defaultReply(channel); });
  expect(await useEditor.getState().apply([{ type: 'deleteItem', itemId: 'clip_0000000001' }], 'Delete')).toBe(false);
  expect(mocks.invoke).toHaveBeenCalledWith('timeline.get', {}); expect(useEditor.getState().error).toContain('latest revision'); expect(useSelection.getState().elements).toHaveLength(1);
});
it('adds text to the text track and edits its content with a nested property patch', async () => {
  useEditor.setState({ timeline: state() }); addText();
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('timeline.apply', expect.objectContaining({ ops: [expect.objectContaining({ type: 'addItem', trackId: 'text', item: expect.objectContaining({ text: 'Your text' }) })] })));
  const doc = timelineDoc(); const added = mocks.invoke.mock.calls.find(([c]) => c === 'timeline.apply')?.[1].ops[0].item; doc.tracks.find((t) => t.kind === 'text')!.items.push(added);
  useEditor.setState({ timeline: { ...state(), doc } }); useSelection.getState().select({ itemId: added.id }); render(<Inspector />);
  const field = screen.getByRole('textbox', { name: 'Content' }); fireEvent.change(field, { target: { value: 'A new title' } }); fireEvent.blur(field);
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('timeline.apply', expect.objectContaining({ ops: [{ type: 'setProps', itemId: added.id, patch: { text: 'A new title' } }] })));
});
it('validates sandbox hostnames and saves a reviewed domain-only patch', async () => {
  render(<WorkspaceSettings section="Sandbox" />); const input = await screen.findByLabelText('Allowed domains');
  fireEvent.change(input, { target: { value: 'https://x.com' } }); fireEvent.click(screen.getByRole('button', { name: 'Add' })); expect(screen.getByText(/Enter a hostname/)).toBeTruthy();
  fireEvent.change(input, { target: { value: 'x.com' } }); fireEvent.click(screen.getByRole('button', { name: 'Add' })); fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(mocks.invoke.mock.calls.some(([c]) => c === 'settings.update')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Save sandbox settings' })); await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('settings.update', { patch: { sandbox: { ...defaultGlobalSettings().sandbox, allowedDomains: ['x.com'] } } }));
});
it('prompts before leaving a dirty settings draft and can keep editing', async () => {
  useNavigation.setState({ destination: 'settings', settingsSection: 'Sandbox' }); render(<><WorkspaceSettings section="Sandbox" /><SettingsLeaveDialog /></>);
  fireEvent.change(await screen.findByLabelText('Allowed domains'), { target: { value: 'x.com' } }); fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  act(() => useNavigation.getState().setSettingsSection('Extensions'));
  expect(screen.getByRole('dialog', { name: 'Save changes before leaving?' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Keep editing' })); expect(useNavigation.getState().settingsSection).toBe('Sandbox');
});
it('disables Scribe without a connected ElevenLabs account', async () => {
  render(<WorkspaceSettings section="Voice input" />); const scribe = await screen.findByRole('radio', { name: /ElevenLabs Scribe/ }); expect((scribe as HTMLInputElement).disabled).toBe(true); expect(screen.getByText('Connect ElevenLabs in Accounts to use Scribe.')).toBeTruthy();
});
it('previews cleanup exactly and removes only the confirmed token', async () => {
  useNavigation.setState({ project: session }); replies['storage.usage'] = { categories: [], totalBytes: 20 }; replies['storage.cleanPreview'] = { token: 'cleanup-token', bytes: 20, items: [{ rel: 'work/cache.bin', bytes: 20, category: 'thumbnails' }] };
  render(<WorkspaceSettings section="Storage / snapshots" />); fireEvent.click(await screen.findByRole('button', { name: 'Review cleanup' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'thumbnails' })); fireEvent.click(screen.getByRole('button', { name: 'Preview cleanup' })); await screen.findByText('work/cache.bin');
  expect(mocks.invoke.mock.calls.some(([c]) => c === 'storage.clean')).toBe(false); fireEvent.click(screen.getByRole('button', { name: 'Remove 1 items' }));
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('storage.clean', { token: 'cleanup-token' }));
});
it('requires MCP validation and explicit trust; credentials never appear in review', async () => {
  replies['extensions.validate'] = { commandPreview: '/usr/bin/node server.js', domains: [], scopes: ['Runs as your user'] };
  render(<ExtensionsSettings />); fireEvent.click(screen.getByRole('button', { name: 'Add MCP server' }));
  for (const [name, value] of [['Display name', 'My server'], ['Server id', 'my-server'], ['Executable (absolute path)', '/usr/bin/node'], ['Environment name', 'API_KEY'], ['Secret value', 'test-secret']]) fireEvent.change(screen.getByLabelText(name!), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Review server' })); const dialog = await screen.findByRole('dialog', { name: 'Review MCP server' });
  expect(dialog.textContent).not.toContain('test-secret'); expect((within(dialog).getByRole('button', { name: 'Install' }) as HTMLButtonElement).disabled).toBe(true);
  expect(mocks.invoke.mock.calls.some(([c]) => c === 'extensions.add')).toBe(false); fireEvent.click(screen.getByRole('checkbox', { name: /I trust this server/ })); fireEvent.click(screen.getByRole('button', { name: 'Install' }));
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('extensions.add', expect.objectContaining({ secretEnv: { API_KEY: 'test-secret' } }))); expect(screen.queryByDisplayValue('test-secret')).toBeNull();
});
it('blocks export with the actual preflight reason', async () => {
  replies['export.preflight'] = { canExport: false, blockers: ['Add a video clip before exporting.'], unsupportedItems: [] };
  render(<ExportDialog onClose={() => {}} />); await screen.findByText('Add a video clip before exporting.'); expect((screen.getByRole('button', { name: 'Export video' }) as HTMLButtonElement).disabled).toBe(true);
});
it('acknowledges unsupported items and follows the export job through success', async () => {
  replies['export.preflight'] = { canExport: true, blockers: [], unsupportedItems: [{ itemId: 'text_0000000001', name: 'Title', type: 'text' }] }; replies['export.start'] = { jobId: 'job1' };
  render(<ExportDialog onClose={() => {}} />); await screen.findByText('Title (text)'); const button = screen.getByRole('button', { name: 'Export video' }); expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Export without these items' })); fireEvent.click(button);
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('export.start', { presetId: preset.id, acknowledgeUnsupported: true }));
  act(() => mocks.listeners.get('jobs.changed')?.([{ ...job, status: 'running', phase: 'Compositing', progress: 0.5 }])); expect(screen.getByRole('progressbar')).toBeTruthy();
  act(() => mocks.listeners.get('jobs.changed')?.([{ ...job, status: 'done', progress: 1, result: { rel: 'final/coast_v001.mp4' } }]));
  fireEvent.click(await screen.findByRole('button', { name: 'Play video' })); fireEvent.click(screen.getByRole('button', { name: 'Reveal in Finder' }));
  expect(mocks.invoke).toHaveBeenCalledWith('shell.openInProject', { rel: 'final/coast_v001.mp4' }); expect(mocks.invoke).toHaveBeenCalledWith('shell.revealInProject', { rel: 'final/coast_v001.mp4' });
});
it('never downloads on paste/fetch and requires rights for the selected format', async () => {
  replies['urlImport.fetch'] = { title: 'Coast', uploader: 'Creator', durationSec: 5, formats: [{ id: 'best', label: '1080p', ext: 'mp4' }] }; replies['urlImport.download'] = { jobId: 'job1' };
  render(<UrlImportDialog onClose={() => {}} />); fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://www.youtube.com/watch?v=fixture' } });
  expect(mocks.invoke.mock.calls.some(([c]) => c === 'urlImport.fetch')).toBe(false); fireEvent.click(screen.getByRole('button', { name: 'Fetch formats' }));
  const download = await screen.findByRole('button', { name: 'Download' }); expect((download as HTMLButtonElement).disabled).toBe(true); expect(mocks.invoke.mock.calls.some(([c]) => c === 'urlImport.download')).toBe(false);
  fireEvent.click(screen.getByRole('checkbox', { name: /I own this content/ })); fireEvent.click(download);
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('urlImport.download', { url: 'https://www.youtube.com/watch?v=fixture', formatId: 'best', destination: 'references', rightsConfirmed: true }));
});
it('shows the unsupported-site error without dropping the entered URL', async () => {
  mocks.invoke.mockImplementation(async (channel: string) => { if (channel === 'urlImport.fetch') throw new IpcFailure({ code: 'unavailable', message: 'unsupported', details: { code: 'unsupported_site' } }); return defaultReply(channel); });
  render(<UrlImportDialog onClose={() => {}} />); fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://unsupported.test/video' } }); fireEvent.click(screen.getByRole('button', { name: 'Fetch formats' }));
  await screen.findByText(/This site isn't supported/); expect((screen.getByLabelText('URL') as HTMLInputElement).value).toBe('https://unsupported.test/video');
});
it('streams into one assistant message and explicitly allows a permission', async () => {
  useAssistant.setState({ sessionId: 'agent1' }); render(<Assistant />);
  act(() => { useAssistant.getState().receive({ type: 'text_delta', sessionId: 'agent1', text: 'Hello ' }); useAssistant.getState().receive({ type: 'text_delta', sessionId: 'agent1', text: 'world' }); useAssistant.getState().receive({ type: 'permission_request', sessionId: 'agent1', requestId: 'req1', tool: 'download_url', description: 'Download this video?', input: {} }); });
  expect(screen.getByText('Hello world')).toBeTruthy(); expect(useAssistant.getState().messages).toHaveLength(1); fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('agent.respondPermission', { requestId: 'req1', allow: true })); expect(screen.getByText('API-equivalent estimate · —')).toBeTruthy();
});
it('replaces streaming text with the final assistant message and completes tool calls without duplication', () => {
  useAssistant.setState({ sessionId: 'agent1' });
  const receive = useAssistant.getState().receive;
  receive({ type: 'text_delta', sessionId: 'agent1', text: 'First ' });
  receive({ type: 'text_delta', sessionId: 'agent1', text: 'answer' });
  receive({ type: 'tool_start', sessionId: 'agent1', toolUseId: 'tool1', name: 'timeline_read', input: {} });
  receive({ type: 'tool_end', sessionId: 'agent1', toolUseId: 'tool1', name: 'timeline_read', output: {}, isError: false });
  receive({ type: 'message', sessionId: 'agent1', role: 'assistant', text: 'First answer.' });
  receive({ type: 'message', sessionId: 'agent1', role: 'assistant', text: 'First answer.' });
  expect(useAssistant.getState().messages).toEqual([{ role: 'assistant', text: 'First answer.' }]);
  expect(useAssistant.getState().tools).toEqual([{ id: 'tool1', name: 'timeline_read', done: true, error: false }]);
  receive({ type: 'text_delta', sessionId: 'agent1', text: 'Next answer' });
  receive({ type: 'message', sessionId: 'agent1', role: 'assistant', text: 'Next answer' });
  expect(useAssistant.getState().messages).toEqual([{ role: 'assistant', text: 'First answer.' }, { role: 'assistant', text: 'Next answer' }]);
});
it('does not deduplicate an assistant reply against equal user text', () => {
  useAssistant.setState({ sessionId: 'agent1', messages: [{ role: 'user', text: 'Hello' }] });
  useAssistant.getState().receive({ type: 'message', sessionId: 'agent1', role: 'assistant', text: 'Hello' });
  expect(useAssistant.getState().messages).toEqual([{ role: 'user', text: 'Hello' }, { role: 'assistant', text: 'Hello' }]);
});
it('Home requires a project, then starts and sends one goal through Claude', async () => {
  replies['accounts.list'] = [account]; replies['agent.start'] = { sessionId: 'agent1' };
  render(<Home />); await screen.findByText('Choose or create a project to start.'); expect((screen.getByRole('button', { name: 'Start' }) as HTMLButtonElement).disabled).toBe(true);
  act(() => useNavigation.setState({ project: session })); fireEvent.change(screen.getByLabelText('Describe your video'), { target: { value: 'Make a coastal teaser' } }); fireEvent.click(screen.getByRole('button', { name: 'Start' }));
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('agent.send', expect.objectContaining({ sessionId: 'agent1', text: 'Make a coastal teaser' })));
  expect(useNavigation.getState()).toMatchObject({ destination: 'project', tab: 'Editor', dock: 'Assistant' });
});
it('freezes Ask context at opening and sends with command-Enter', async () => {
  useNavigation.setState({ project: session }); replies['agent.start'] = { sessionId: 'agent1' }; render(<AskDialog onClose={() => {}} />);
  expect(screen.getByText('Whole edit · 0.00 s')).toBeTruthy(); act(() => previewClock.seek(5));
  const input = screen.getByRole('textbox', { name: 'Your request' }); fireEvent.change(input, { target: { value: 'Explain the edit' } }); fireEvent.keyDown(input, { key: 'Enter', metaKey: true });
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('agent.send', expect.objectContaining({ context: { itemIds: [], time: 0 } })));
});
it('Codex never launches on mount, has no token field and stops polling on sign-in', async () => {
  replies['accounts.codex.status'] = { available: true, loggedIn: false, mode: null }; render(<CodexSignIn />); const open = await screen.findByRole('button', { name: 'Open Terminal to sign in' });
  expect(mocks.invoke.mock.calls.some(([c]) => c === 'accounts.codex.openLogin')).toBe(false); expect(screen.queryByRole('textbox')).toBeNull();
  vi.useFakeTimers(); fireEvent.click(open); await act(async () => { await Promise.resolve(); }); expect(mocks.invoke.mock.calls.filter(([c]) => c === 'accounts.codex.openLogin')).toHaveLength(1);
  replies['accounts.codex.status'] = { available: true, loggedIn: true, mode: 'chatgpt' }; await act(async () => { vi.advanceTimersByTime(3000); }); expect(screen.getByText('Signed in with ChatGPT')).toBeTruthy();
  const calls = mocks.invoke.mock.calls.length; await act(async () => { vi.advanceTimersByTime(120000); }); expect(mocks.invoke.mock.calls.length).toBe(calls);
});
it('shows unknown audio balance and sends the selected voice and script', async () => {
  useNavigation.setState({ project: session });
  replies['accounts.list'] = [{ ...account, provider: 'elevenlabs' }]; replies['audio.voices'] = [{ id: 'voice1', name: 'Narrator' }]; replies['audio.generate'] = { jobId: 'audio1' };
  render(<AudioDock />); await screen.findByRole('textbox', { name: 'Script' }); await screen.findByRole('option', { name: 'Narrator' }); expect(screen.getByText('Balance unavailable')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Script'), { target: { value: 'The coast at dawn.' } }); fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('audio.generate', expect.objectContaining({ kind: 'tts', voiceId: 'voice1', text: 'The coast at dawn.' })));
});
it('transcribes the chosen source and maps transcript words through clip in/speed', async () => {
  const doc = timelineDoc(); const clip = doc.tracks.find((t) => t.kind === 'video')!.items[0]!; if (clip.type !== 'clip') throw new Error('fixture'); clip.start = 4; clip.speed = 2;
  useEditor.setState({ timeline: { ...state(), doc }, media: [media] }); useSelection.getState().select({ itemId: clip.id });
  replies['transcripts.get'] = { words: [{ text: 'coast', start: 3, end: 4 }] }; replies['transcripts.start'] = { jobId: 'transcript1' };
  render(<TranscriptDock />); fireEvent.click(await screen.findByRole('button', { name: 'coast' })); expect(previewClock.getSnapshot().time).toBe(4.5);
  fireEvent.click(screen.getByRole('button', { name: 'Regenerate' })); await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('transcripts.start', { rel: media.rel, engine: 'whisper', model: 'base' }));
  fireEvent.click(screen.getByRole('button', { name: 'Generate captions' })); expect(mocks.invoke).toHaveBeenCalledWith('captions.generate', { clipItemId: clip.id });
});
it('records bytes, stops all microphone tracks and appends the transcription', async () => {
  const stop = vi.fn(); const onText = vi.fn(); replies['voice.transcribe'] = { text: 'A spoken idea' };
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }) } });
  class Recorder {
    state = 'inactive'; ondataavailable: ((event: { data: Blob }) => void) | null = null; onstop: (() => void) | null = null; onerror: (() => void) | null = null;
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['audio']) }); this.onstop?.(); }
  }
  vi.stubGlobal('MediaRecorder', Recorder); Object.defineProperty(Blob.prototype, 'arrayBuffer', { configurable: true, value: async () => new Uint8Array([1, 2, 3]).buffer });
  render(<VoiceButton onText={onText} />); await waitFor(() => expect((screen.getByRole('button', { name: 'Voice input' }) as HTMLButtonElement).disabled).toBe(false)); fireEvent.click(screen.getByRole('button', { name: 'Voice input' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Stop recording' })); await waitFor(() => expect(onText).toHaveBeenCalledWith('A spoken idea')); expect(stop).toHaveBeenCalled();
  expect(mocks.invoke).toHaveBeenCalledWith('voice.transcribe', { audio: expect.any(Uint8Array), mime: 'audio/webm', engine: 'whisper' });
});
it('keeps root media read-only and explicitly adopts only its relative names', async () => {
  const root = { ...media, rel: 'coast.mp4', section: 'root' };
  replies['media.list'] = [root]; replies['project.adoptLooseMedia'] = [media];
  render(<MediaBrowser folder={{ id: session.project.id, root: session.rootPath }} />);
  const section = await screen.findByRole('region', { name: 'Folder root' });
  expect(within(section).getByText("Files stay in this folder. Agents can't change them.")).toBeTruthy();
  fireEvent.click(within(section).getByRole('button', { name: 'Copy into Footage' }));
  await screen.findByText('Copied to Footage. Original kept.');
  expect(mocks.invoke).toHaveBeenCalledWith('project.adoptLooseMedia', { rels: ['coast.mp4'] });
});
it('adds a video card once and selects the editor only after its revision is saved', async () => {
  useNavigation.setState({ project: session }); useEditor.setState({ timeline: state() }); replies['media.list'] = [media];
  render(<MediaBrowser folder={{ id: session.project.id, root: session.rootPath }} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Add to timeline' }));
  await waitFor(() => expect(useNavigation.getState().destination).toBe('project'));
  const calls = mocks.invoke.mock.calls.filter(([c]) => c === 'timeline.apply');
  expect(calls).toHaveLength(1); expect(calls[0]?.[1].ops).toEqual([expect.objectContaining({ type: 'addItem', trackId: 'video' })]);
});
it('quantizes a timeline media drop to the document frame rate', async () => {
  const doc = timelineDoc(); doc.format.fps = 24; useEditor.setState({ timeline: { ...state(), doc }, media: [media] });
  render(<Timeline doc={doc} apply={useEditor.getState().apply} />);
  const lane = screen.getByLabelText('Video (main) track drop area');
  const drop = createEvent.drop(lane, { dataTransfer: { types: [MEDIA_DRAG_TYPE], getData: () => JSON.stringify({ rel: media.rel }) } }); Object.defineProperty(drop, 'clientX', { value: 79 }); fireEvent(lane, drop);
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('timeline.apply', expect.objectContaining({ ops: [expect.objectContaining({ type: 'addItem', trackId: 'video', item: expect.objectContaining({ start: 30 / 24 }) })] })));
});
it('splits a selected clip exactly once with S and never from a text field', async () => {
  const doc = timelineDoc(); render(<Timeline doc={doc} apply={useEditor.getState().apply} />); useEditor.setState({ timeline: state() });
  useSelection.getState().select({ itemId: 'clip_0000000001' }); previewClock.seek(1.51); keymap.setScopes(['editor']); const detach = keymap.attach();
  try {
    fireEvent.keyDown(document.body, { key: 's' });
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('timeline.apply', expect.objectContaining({ ops: [{ type: 'splitItem', itemId: 'clip_0000000001', at: 45 / 30 }] })));
    const input = document.createElement('input'); document.body.append(input); fireEvent.keyDown(input, { key: 's' }); input.remove();
    expect(mocks.invoke.mock.calls.filter(([c]) => c === 'timeline.apply')).toHaveLength(1);
  } finally { detach(); keymap.setScopes([]); }
});
it('handles command-Z and command-K in the real app shell', async () => {
  replies['project.current'] = session; useNavigation.setState({ project: session, destination: 'project' });
  render(<App />); await waitFor(() => expect(useEditor.getState().timeline).not.toBeNull());
  fireEvent.keyDown(document.body, { key: 'z', metaKey: true });
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('timeline.undo', {}));
  fireEvent.keyDown(document.body, { key: 'k', metaKey: true });
  expect(screen.getByRole('dialog', { name: 'Ask Claude' })).toBeTruthy(); expect(screen.getByText('Whole edit · 0.00 s')).toBeTruthy();
});
it('updates clip speed and derived duration together in one operation', async () => {
  useEditor.setState({ timeline: state(), media: [media] }); useSelection.getState().select({ itemId: 'clip_0000000001' }); render(<Inspector />);
  const speed = screen.getByRole('spinbutton', { name: 'Speed (×)' }); fireEvent.change(speed, { target: { value: '2' } }); fireEvent.blur(speed);
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('timeline.apply', expect.objectContaining({ ops: [{ type: 'setProps', itemId: 'clip_0000000001', patch: { speed: 2, duration: 2.5 } }] })));
});
it('does not reuse an expired cleanup token or renew it automatically', async () => {
  useNavigation.setState({ project: session }); replies['storage.usage'] = { categories: [], totalBytes: 20 }; replies['storage.cleanPreview'] = { token: 'expired-token', bytes: 20, items: [{ rel: 'work/cache.bin', bytes: 20, category: 'thumbnails' }] };
  mocks.invoke.mockImplementation(async (channel: string) => { if (channel === 'storage.clean') throw new IpcFailure({ code: 'forbidden', message: 'Expired' }); return channel in replies ? replies[channel] : defaultReply(channel); });
  render(<WorkspaceSettings section="Storage / snapshots" />); fireEvent.click(await screen.findByRole('button', { name: 'Review cleanup' })); fireEvent.click(screen.getByRole('checkbox', { name: 'thumbnails' })); fireEvent.click(screen.getByRole('button', { name: 'Preview cleanup' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Remove 1 items' })); await screen.findByText('This cleanup preview expired. Review the current files before removing anything.');
  expect((screen.getByRole('button', { name: 'Remove 1 items' }) as HTMLButtonElement).disabled).toBe(true);
  expect(mocks.invoke.mock.calls.filter(([c]) => c === 'storage.cleanPreview')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Review again' })); expect(screen.getByRole('button', { name: 'Preview cleanup' })).toBeTruthy();
});
it('saves a custom preset without silently saving the separate default draft', async () => {
  replies['export.presets'] = [preset, { ...preset, id: 'other', name: 'Other' }];
  render(<WorkspaceSettings section="Render presets" />); fireEvent.change(await screen.findByLabelText('Default preset'), { target: { value: 'other' } }); fireEvent.click(screen.getByRole('button', { name: 'New preset' }));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'My export' } }); fireEvent.click(screen.getByRole('button', { name: 'Save preset' }));
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('settings.update', { patch: { renderPresets: { defaultId: 'draft', custom: [expect.objectContaining({ name: 'My export' })] } } }));
  expect((screen.getByLabelText('Default preset') as HTMLSelectElement).value).toBe('other'); expect(screen.getByText('Unsaved changes')).toBeTruthy();
});
it('shows the actual fixed ProRes profile instead of a fake quality input', async () => {
  render(<WorkspaceSettings section="Render presets" />); fireEvent.click(await screen.findByRole('button', { name: 'New preset' }));
  fireEvent.change(screen.getByLabelText('Video codec'), { target: { value: 'prores' } });
  expect((screen.getByLabelText('Container') as HTMLSelectElement).value).toBe('mov'); expect(screen.getByText('ProRes 422 HQ · 10-bit 4:2:2. Quality uses this fixed profile.')).toBeTruthy();
  expect(screen.queryByLabelText('Bitrate (kb/s)')).toBeNull(); expect(screen.queryByLabelText('CRF (0–51)')).toBeNull();
});
it('keeps a saved settings draft clean even before the settings event arrives', async () => {
  render(<WorkspaceSettings section="Sandbox" />); fireEvent.change(await screen.findByLabelText('Allowed domains'), { target: { value: 'x.com' } }); fireEvent.click(screen.getByRole('button', { name: 'Add' })); fireEvent.click(screen.getByRole('button', { name: 'Save changes' })); fireEvent.click(screen.getByRole('button', { name: 'Save sandbox settings' }));
  await screen.findByText('Saved'); expect((screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(true); expect(useSettingsGuard.getState().guard).toBeNull();
});
it('shows builtin extension prerequisites while leaving an enabled connection disableable', async () => {
  replies['accounts.codex.status'] = { available: true, loggedIn: false, mode: null };
  replies['extensions.list'] = [{ config: { id: 'codex', name: 'Codex', enabled: false, transport: 'builtin' }, builtin: true, status: 'unavailable', detail: null, secretEnvNames: [] }, { config: { id: 'elevenlabs', name: 'ElevenLabs', enabled: true, transport: 'builtin' }, builtin: true, status: 'unavailable', detail: null, secretEnvNames: [] }];
  render(<ExtensionsSettings />); await screen.findByText('Sign-in required'); expect((screen.getByRole('checkbox', { name: 'Enable Codex' }) as HTMLInputElement).disabled).toBe(true); expect((screen.getByRole('checkbox', { name: 'Enable ElevenLabs' }) as HTMLInputElement).disabled).toBe(false);
  expect(screen.getAllByRole('button', { name: 'Open Accounts' })).toHaveLength(2);
});
it('keeps a backgrounded export in the jobs indicator and cancels there', async () => {
  replies['export.start'] = { jobId: 'job1' }; const close = vi.fn(); render(<><ExportDialog onClose={close} /><JobsIndicator /></>);
  const start = await screen.findByRole('button', { name: 'Export video' }); await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false)); fireEvent.click(start);
  fireEvent.click(await screen.findByRole('button', { name: 'Run in background' })); expect(close).toHaveBeenCalledOnce();
  act(() => mocks.listeners.get('jobs.changed')?.([{ ...job, status: 'running', progress: 0.5, phase: 'Encoding' }]));
  fireEvent.click(screen.getByRole('button', { name: '1 jobs running' })); const popover = screen.getByRole('region', { name: 'Background jobs' }); fireEvent.click(within(popover).getByRole('button', { name: 'Cancel' }));
  expect(mocks.invoke).toHaveBeenCalledWith('jobs.cancel', { id: 'job1' });
});
it('shows real three-way review values and defaults conflict resolution to current', async () => {
  useAssistant.setState({ sessionId: 'agent1' }); const doc = timelineDoc(); const clip = doc.tracks.find((t) => t.kind === 'video')!.items[0]!;
  useAssistant.getState().receive({ type: 'change', sessionId: 'agent1', requestId: 'change1', itemId: clip.id, paths: ['start'], before: clip, after: { ...clip, start: 1 } });
  mocks.invoke.mockImplementation(async (channel: string, request: { resolution?: string }) => { if (channel === 'agent.review.revert' && !request.resolution) throw new IpcFailure({ code: 'conflict', message: 'Changed', details: { conflicts: [{ itemId: clip.id, path: 'start', original: 0, agent: 1, current: 2 }] } }); return defaultReply(channel); });
  const { container } = render(<><Assistant /><Timeline doc={doc} /></>); await waitFor(() => expect(container.querySelector('.item-agent-changed')).not.toBeNull()); fireEvent.click(screen.getByRole('button', { name: 'Revert all' }));
  const dialog = await screen.findByRole('dialog', { name: "This item changed after Claude's edit" });
  for (const heading of ['Original', 'Agent', 'Current']) expect(within(dialog).getByRole('heading', { name: heading })).toBeTruthy(); expect((within(dialog).getByRole('radio', { name: 'Keep current' }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Resolve' })); await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('agent.review.revert', { requestId: 'change1', resolution: 'keepCurrent' }));
});
it('rejects caption end-before-start edits without submitting an operation', () => {
  const doc = timelineDoc(); doc.tracks.find((t) => t.kind === 'captions')!.items.push({ type: 'caption', id: 'caption_0000000001', start: 10, duration: 5, words: [{ id: 'word1', text: 'coast', start: 1, end: 2 }], stylePreset: 'Clean', highlight: null, createdBy: 'user', userEdited: [] }); useEditor.setState({ timeline: { ...state(), doc } }); useSelection.getState().select({ itemId: 'caption_0000000001' }); render(<Inspector />);
  const end = screen.getByRole('spinbutton', { name: 'end (s)' }); fireEvent.change(end, { target: { value: '0.5' } }); fireEvent.blur(end);
  expect(screen.getByText('Word times must be monotonic; each end must be at or after its start.')).toBeTruthy(); expect(mocks.invoke.mock.calls.some(([c]) => c === 'timeline.apply')).toBe(false);
});
it('uses item-local caption times without subtracting timeline start', () => {
  const item = { type: 'caption' as const, id: 'caption_0000000001', start: 10, duration: 5, words: [{ id: 'word1', text: 'coast', start: 1, end: 2 }], stylePreset: 'Clean' as const, highlight: null, createdBy: 'user' as const, userEdited: [] };
  expect(JSON.parse(overlayProps(item).captions!.words as string)).toEqual(item.words);
});
it('renders schema-driven colour and bounded numeric composition controls with literal prop ids', async () => {
  useNavigation.setState({ project: session }); replies['app.getInfo'] = { ...(defaultReply('app.getInfo') as object), compBaseUrl: 'http://127.0.0.1:1234/k/test/' };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version: 1, elements: [{ id: 'title.part', name: 'Title', kind: 'text', props: { color: { type: 'color', bind: 'css:--color', default: '#ffffff' }, size: { type: 'number', bind: 'css:--size', default: 64, min: 12, max: 120 } } }] }) }));
  const doc = timelineDoc(); doc.tracks.find((t) => t.kind === 'overlay')!.items.push({ type: 'composition', id: 'composition_0000000001', start: 0, duration: 5, engine: 'hyperframes', path: 'compositions/title%20one', props: {}, createdBy: 'user', userEdited: [] }); useEditor.setState({ timeline: { ...state(), doc } }); useSelection.getState().select({ itemId: 'composition_0000000001' });
  render(<Inspector />); const size = await screen.findByRole('spinbutton', { name: 'size' }); expect(size.getAttribute('min')).toBe('12'); expect(size.getAttribute('max')).toBe('120'); expect(screen.getByLabelText('color').getAttribute('type')).toBe('color'); fireEvent.change(size, { target: { value: '70' } }); fireEvent.blur(size);
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('timeline.apply', expect.objectContaining({ ops: [{ type: 'setProps', itemId: 'composition_0000000001', patch: { props: { 'title.part': { size: 70 } } } }] })));
  expect(compositionUrl('http://127.0.0.1:1234/k/test/', 'coast', doc.tracks.find((t) => t.kind === 'overlay')!.items[0] as Parameters<typeof compositionUrl>[2])).toContain('title%2520one');
});
it('keeps composition previews opaque and requires Remotion licence acknowledgement first', async () => {
  replies['app.getInfo'] = { ...(defaultReply('app.getInfo') as object), compBaseUrl: 'http://127.0.0.1:1234/k/test/' }; replies['compositions.templates'] = [{ id: 'remotion-title', name: 'Title', engine: 'remotion', description: 'Title' }];
  const doc = timelineDoc(); doc.tracks.find((t) => t.kind === 'text')!.items.push({ type: 'text', id: 'text_0000000001', text: 'Title', start: 0, duration: 5, style: { fontFamily: 'Arial', fontSize: 64, fontWeight: 600, color: '#ffffff', align: 'center' }, layout: { x: 0.1, y: 0.1, w: 0.8, h: 0.2, rotation: 0, anchor: 'top-left' }, animation: { in: 'fade', out: 'fade', inDuration: 0.25, outDuration: 0.25, easing: 'power2.out' }, createdBy: 'user', userEdited: [] });
  const { container } = render(<><CompositionLayers doc={doc} projectId="coast" /><CompositionPicker onClose={() => {}} /></>);
  await waitFor(() => expect(container.querySelector('iframe')?.getAttribute('sandbox')).toBe('allow-scripts'));
  await screen.findByRole('option', { name: 'Title · remotion' }); fireEvent.change(screen.getByLabelText('Template'), { target: { value: 'remotion-title' } }); await screen.findByRole('dialog', { name: 'Using Remotion' }); expect(mocks.invoke.mock.calls.some(([c]) => c === 'compositions.create')).toBe(false);
});
it('microphone denial explains OS access without changing or disabling typed text', async () => {
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError')) } });
  vi.stubGlobal('MediaRecorder', class {}); render(<><textarea aria-label="Typed goal" defaultValue="Keep this draft" /><VoiceButton onText={() => {}} /></>);
  await waitFor(() => expect((screen.getByRole('button', { name: 'Voice input' }) as HTMLButtonElement).disabled).toBe(false)); fireEvent.click(screen.getByRole('button', { name: 'Voice input' }));
  await screen.findByText('Microphone access is off. Allow Cutroom in System Settings → Privacy & Security → Microphone, then try again. You can keep typing.');
  const input = screen.getByLabelText('Typed goal') as HTMLTextAreaElement; expect(input.value).toBe('Keep this draft'); expect(input.disabled).toBe(false); expect(mocks.invoke.mock.calls.some(([c]) => c === 'voice.transcribe')).toBe(false);
});
it('discards one capture with Escape and ignores its late callback during a new capture', async () => {
  const stop = vi.fn(), onText = vi.fn(); const recorders: Recorder[] = [];
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }) } });
  class Recorder {
    state = 'inactive'; ondataavailable: ((event: { data: Blob }) => void) | null = null; onstop: (() => void) | null = null; onerror: (() => void) | null = null;
    constructor() { recorders.push(this); } start() { this.state = 'recording'; } stop() { this.state = 'inactive'; }
  }
  vi.stubGlobal('MediaRecorder', Recorder); Object.defineProperty(Blob.prototype, 'arrayBuffer', { configurable: true, value: async () => new Uint8Array([1]).buffer }); replies['voice.transcribe'] = { text: 'New capture only' };
  const view = render(<VoiceButton onText={onText} />); await waitFor(() => expect((screen.getByRole('button', { name: 'Voice input' }) as HTMLButtonElement).disabled).toBe(false)); fireEvent.click(screen.getByRole('button', { name: 'Voice input' })); await screen.findByRole('button', { name: 'Stop recording' }); fireEvent.keyDown(window, { key: 'Escape' }); expect(stop).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Voice input' })); await screen.findByRole('button', { name: 'Stop recording' });
  act(() => { recorders[0]!.ondataavailable?.({ data: new Blob(['old']) }); recorders[0]!.onstop?.(); }); expect(mocks.invoke.mock.calls.some(([c]) => c === 'voice.transcribe')).toBe(false);
  act(() => { recorders[1]!.ondataavailable?.({ data: new Blob(['new']) }); }); fireEvent.click(screen.getByRole('button', { name: 'Stop recording' })); act(() => recorders[1]!.onstop?.()); await waitFor(() => expect(onText).toHaveBeenCalledExactlyOnceWith('New capture only')); expect(stop).toHaveBeenCalledTimes(2); view.unmount();
});
it('freezes generated audio insertion time and track even when the next form is changed', async () => {
  useNavigation.setState({ project: session }); useEditor.setState({ timeline: state() }); previewClock.configure(20, 30); previewClock.seek(3);
  replies['accounts.list'] = [{ ...account, provider: 'elevenlabs' }]; replies['audio.voices'] = [{ id: 'voice1', name: 'Narrator' }]; replies['audio.generate'] = { jobId: 'audio1' }; replies['media.list'] = [{ ...media, rel: 'audio/voice.wav', name: 'voice.wav', kind: 'audio' }];
  render(<AudioDock />); await screen.findByRole('option', { name: 'Narrator' }); fireEvent.change(screen.getByLabelText('Script'), { target: { value: 'At dawn' } }); fireEvent.click(screen.getByRole('button', { name: 'Generate' })); await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('audio.generate', expect.objectContaining({ kind: 'tts' })));
  fireEvent.change(screen.getByLabelText('Section'), { target: { value: 'music' } }); fireEvent.click(screen.getByRole('checkbox', { name: 'Insert at playhead' })); previewClock.seek(9);
  act(() => mocks.listeners.get('jobs.changed')?.([{ ...job, id: 'audio1', kind: 'audio', status: 'done', result: { rel: 'audio/voice.wav' } }]));
  expect(mocks.invoke).toHaveBeenCalledWith('audio.generate', expect.objectContaining({ kind: 'tts', placement: { time: 3, track: 'voiceover' } }));
  expect(mocks.invoke.mock.calls.some(([c]) => c === 'timeline.apply')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Generate' })); await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('audio.generate', { kind: 'music', text: 'At dawn', durationSec: 10 }));
});
it('does not accept an old assistant start response after switching project A to B to A', async () => {
  useNavigation.setState({ project: session }); let resolveStart!: (value: { sessionId: string }) => void; mocks.invoke.mockImplementation((channel: string) => channel === 'agent.start' ? new Promise((resolve) => { resolveStart = resolve; }) : Promise.resolve(defaultReply(channel)));
  const sent = useAssistant.getState().send('Old project request'); useNavigation.setState({ project: { ...session, project: { ...session.project, id: 'other' } } }); useNavigation.setState({ project: session }); resolveStart({ sessionId: 'stale' }); expect(await sent).toBe(false); expect(useAssistant.getState().sessionId).toBeNull(); expect(mocks.invoke.mock.calls.some(([c]) => c === 'agent.send')).toBe(false);
});
