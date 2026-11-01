import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IpcFailure } from '@shared/ipc';
import type { AccountInfo, ClaudeCodeStatus, Provider } from '@shared/schema/accounts';
import { Accounts } from '../../src/renderer/pages/Accounts';
import { Sidebar } from '../../src/renderer/components/Sidebar';
import { Home } from '../../src/renderer/pages/Home';
import { useNavigation } from '../../src/renderer/state/navigation';
import { EditorWorkspace } from '../../src/renderer/editor/EditorWorkspace';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listeners: new Map<string, (payload: unknown) => void>() }));
vi.mock('../../src/renderer/lib/api', () => ({ api: { invoke: mocks.invoke, on: (event: string, listener: (payload: unknown) => void) => { mocks.listeners.set(event, listener); return () => mocks.listeners.delete(event); } } }));
const account = (provider: Provider, patch: Partial<AccountInfo> = {}): AccountInfo => ({ provider, status: 'not_connected', method: null, keyPreview: null, detail: null, checkedAt: null, ...patch });
const cli = (patch: Partial<ClaudeCodeStatus> = {}): ClaudeCodeStatus => ({ available: true, loggedIn: false, authMethod: 'none', email: null, organization: null, cliVersion: '2.1', binarySource: 'installed', ...patch });
let accounts: AccountInfo[];
beforeEach(() => {
  accounts = [account('anthropic'), account('openai'), account('elevenlabs')];
  mocks.invoke.mockReset(); mocks.listeners.clear();
  mocks.invoke.mockImplementation(async (channel: string) => channel === 'accounts.list' ? accounts : channel === 'accounts.claudeCode.status' ? cli() : channel === 'tools.list' || channel === 'models.list' ? [] : { ok: true });
  useNavigation.setState({ destination: 'home', settingsSection: 'Accounts', goalDraft: '', goalFocusRequest: 0, project: null, recentProjects: [], sidebarCollapsed: false });
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
it('renders three labelled provider cards and password-only, nonpersistent inputs', async () => {
  render(<Accounts />);
  for (const name of ['Claude', 'OpenAI', 'ElevenLabs']) {
    await screen.findByRole('region', { name });
    const input = screen.getByLabelText(`${name} API key`) as HTMLInputElement;
    expect(input.type).toBe('password'); expect(input.autocomplete).toBe('off'); expect(input.getAttribute('spellcheck')).toBe('false');
  }
  expect(screen.getAllByText('Not connected')).toHaveLength(3);
  expect(screen.getAllByText(/Last checked: Not checked yet/)).toHaveLength(3);
});
it('does not mistake a default Claude method for a saved connection', async () => {
  accounts = [account('anthropic', { method: 'claude-code' })];
  render(<Accounts />); const card = await screen.findByRole('region', { name: 'Claude' });
  expect((within(card).getByRole('radio', { name: 'API key from Claude Console Recommended' }) as HTMLInputElement).checked).toBe(true);
  expect(within(card).queryByRole('button', { name: 'Verify' })).toBeNull(); expect(within(card).queryByRole('button', { name: 'Disconnect' })).toBeNull();
});
it.each([
  ['connected', 'Connected'], ['not_connected', 'Not connected'], ['invalid', 'Key rejected'], ['unreachable', "Can't reach service"],
] as const)('maps %s to the %s badge without dropping account detail', async (status, label) => {
  accounts = [account('openai', { status, method: status === 'not_connected' ? null : 'api-key', keyPreview: status === 'not_connected' ? null : '…1234', detail: 'Service detail', checkedAt: '2026-11-01T12:00:00.000Z' })];
  render(<Accounts />); const card = await screen.findByRole('region', { name: 'OpenAI' });
  expect(within(card).getByText(label)).toBeTruthy(); expect(within(card).getByText('Service detail')).toBeTruthy();
  expect(card.querySelector('time')?.getAttribute('datetime')).toBe('2026-11-01T12:00:00.000Z');
});
it.each([true, false])('clears a submitted key immediately on success=%s and never persists it', async (success) => {
  let resolve!: (value: AccountInfo) => void;
  let reject!: (reason: Error) => void;
  const request = new Promise<AccountInfo>((done, fail) => { resolve = done; reject = fail; });
  mocks.invoke.mockImplementation((channel: string) => channel === 'accounts.list' ? Promise.resolve(accounts) : request);
  render(<Accounts />); const card = await screen.findByRole('region', { name: 'OpenAI' });
  const input = within(card).getByLabelText('OpenAI API key') as HTMLInputElement;
  fireEvent.change(input, { target: { value: 'fixture-secret-openai' } }); fireEvent.click(within(card).getByRole('button', { name: 'Connect' }));
  expect(input.value).toBe(''); expect((within(card).getByRole('button', { name: 'Connecting…' }) as HTMLButtonElement).disabled).toBe(true);
  expect(mocks.invoke).toHaveBeenCalledWith('accounts.connectKey', { provider: 'openai', apiKey: 'fixture-secret-openai' });
  expect(JSON.stringify(useNavigation.getState())).not.toContain('fixture-secret-openai');
  expect(JSON.stringify(window.localStorage)).not.toContain('fixture-secret-openai'); expect(JSON.stringify(window.sessionStorage)).not.toContain('fixture-secret-openai');
  if (success) {
    await act(async () => resolve(account('openai', { status: 'connected', method: 'api-key', keyPreview: '…1234', detail: 'Ready', checkedAt: '2026-11-01T12:00:00.000Z' })));
    expect(within(card).getByText('Connected')).toBeTruthy(); expect(within(card).getByText('…1234')).toBeTruthy();
    expect(document.activeElement).toBe(within(card).getByRole('button', { name: 'Verify' }));
    expect(within(card).queryByLabelText('OpenAI API key')).toBeNull();
  } else {
    await act(async () => reject(new IpcFailure({ code: 'forbidden', message: 'OpenAI rejected this key.' })));
    expect(within(card).getByRole('alert').textContent).toContain('OpenAI rejected this key.');
    expect(input.value).toBe(''); expect(document.activeElement).toBe(input); expect(within(card).getByText('Not connected')).toBeTruthy();
  }
});
it('does not expose arbitrary errors that might contain a request key', async () => {
  mocks.invoke.mockImplementation(async (channel: string) => { if (channel === 'accounts.list') return accounts; throw new Error('Raw request: fixture-secret'); });
  render(<Accounts />); const card = await screen.findByRole('region', { name: 'OpenAI' });
  fireEvent.change(within(card).getByLabelText('OpenAI API key'), { target: { value: 'fixture-secret' } });
  fireEvent.click(within(card).getByRole('button', { name: 'Connect' }));
  await within(card).findByRole('alert'); expect(card.textContent).not.toContain('fixture-secret');
});
it('requires disconnect confirmation, retains state on Cancel and focuses the empty field after removal', async () => {
  accounts = [account('openai', { status: 'connected', method: 'api-key', keyPreview: '…1234' })];
  render(<Accounts />); const card = await screen.findByRole('region', { name: 'OpenAI' });
  fireEvent.click(within(card).getByRole('button', { name: 'Disconnect' }));
  let dialog = screen.getByRole('dialog', { name: 'Disconnect OpenAI?' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(mocks.invoke).not.toHaveBeenCalledWith('accounts.disconnect', { provider: 'openai' });
  fireEvent.click(within(card).getByRole('button', { name: 'Disconnect' })); dialog = screen.getByRole('dialog');
  mocks.invoke.mockResolvedValue(account('openai'));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(within(card).getByText('Not connected')).toBeTruthy(); expect(document.activeElement).toBe(within(card).getByLabelText('OpenAI API key'));
});
it('subscribes once across Sidebar, Home and Accounts and updates them live', async () => {
  render(<><Sidebar info={null} /><Home /><Accounts /></>);
  fireEvent.click(await screen.findByRole('button', { name: 'Connect Claude' }));
  expect(useNavigation.getState().destination).toBe('settings'); expect(useNavigation.getState().settingsSection).toBe('Accounts');
  expect(mocks.invoke.mock.calls.filter(([channel]) => channel === 'accounts.list')).toHaveLength(1);
  act(() => mocks.listeners.get('accounts.changed')?.([account('anthropic', { status: 'connected', method: 'claude-code', detail: 'Signed in with Claude Code (editor@example.test)' }), account('openai'), account('elevenlabs', { status: 'connected', method: 'api-key', keyPreview: '…5678', detail: 'Creator · 100 / 10,000 characters' })]));
  expect(screen.getByRole('button', { name: 'Claude connected · Claude Code sign-in' })).toBeTruthy();
  expect(screen.getAllByText(/Creator · 100 \/ 10,000 characters/)).toHaveLength(2);
  expect(screen.getByText('Claude Code sign-in · Signed in with Claude Code (editor@example.test)')).toBeTruthy();
});
it('links live sidebar download progress to Tools and removes it after installation', async () => {
  render(<Sidebar info={null} />); await screen.findByRole('button', { name: 'Connect Claude' });
  const tool = { name: 'ffmpeg', version: '7.1', path: '', source: 'downloaded', status: 'missing', verification: null, install: { state: 'downloading', received: 25, total: 100 }, updatable: false, latestVersion: null, hint: null };
  act(() => mocks.listeners.get('tools.changed')?.([tool]));
  const download = screen.getByRole('button', { name: 'Downloading tools… 25%' });
  expect(screen.getByRole('progressbar', { name: 'Tool setup download' }).getAttribute('aria-valuenow')).toBe('25');
  fireEvent.click(download); expect(useNavigation.getState().settingsSection).toBe('Tools'); expect(useNavigation.getState().destination).toBe('settings');
  act(() => mocks.listeners.get('tools.changed')?.([{ ...tool, install: null, status: 'ok', verification: 'pinned' }]));
  expect(screen.queryByRole('button', { name: /Downloading tools/ })).toBeNull();
});
it('links Audio to Accounts until ElevenLabs connects, then updates the future-feature explanation', async () => {
  render(<EditorWorkspace project={{ id: 'fixture', name: 'Fixture', format: { aspect: '16:9', width: 1920, height: 1080, fps: 30 }, defaultEngine: 'hyperframes', createdAt: '2026-11-01T00:00:00.000Z', folderMap: { raw: 'raw', references: 'references', assets: 'assets', compositions: 'compositions', audio: 'audio', work: 'work', final: 'final' } }} />);
  fireEvent.click(screen.getByRole('tab', { name: 'Audio' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Connect ElevenLabs' }));
  expect(useNavigation.getState().settingsSection).toBe('Accounts'); expect(useNavigation.getState().destination).toBe('settings');
  act(() => mocks.listeners.get('accounts.changed')?.([account('elevenlabs', { status: 'connected', method: 'api-key', keyPreview: '…1234' })]));
  expect(screen.getByText('ElevenLabs connected. Audio generation arrives in a later update.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Connect ElevenLabs' })).toBeNull();
});
it('opens Terminal only on request, polls status and requires explicit Use this sign-in', async () => {
  render(<Accounts />); await screen.findByRole('region', { name: 'Claude' });
  fireEvent.click(screen.getByRole('radio', { name: 'Use my Claude Code sign-in' }));
  const open = await screen.findByRole('button', { name: 'Open Terminal to sign in' });
  expect(mocks.invoke).not.toHaveBeenCalledWith('accounts.claudeCode.openLogin', {});
  vi.useFakeTimers(); fireEvent.click(open); await act(async () => { await Promise.resolve(); });
  expect(mocks.invoke).toHaveBeenCalledWith('accounts.claudeCode.openLogin', {});
  mocks.invoke.mockImplementation(async (channel: string) => channel === 'accounts.claudeCode.status' ? cli({ loggedIn: true, email: 'editor@example.test', authMethod: 'claude.ai' }) : account('anthropic', { status: 'connected', method: 'claude-code', detail: 'Signed in with Claude Code (editor@example.test)' }));
  await act(async () => { vi.advanceTimersByTime(3000); });
  expect(screen.getByText('Signed in as editor@example.test')).toBeTruthy();
  expect(mocks.invoke).not.toHaveBeenCalledWith('accounts.claude.setMethod', { method: 'claude-code' });
  fireEvent.click(screen.getByRole('button', { name: 'Use this sign-in' })); await act(async () => { await Promise.resolve(); });
  expect(mocks.invoke).toHaveBeenCalledWith('accounts.claude.setMethod', { method: 'claude-code' });
  expect(screen.getByText('Signed in with Claude Code (editor@example.test)')).toBeTruthy();
});
it('stops polling at two minutes and after unmount', async () => {
  const { unmount } = render(<Accounts />); await screen.findByRole('region', { name: 'Claude' });
  fireEvent.click(screen.getByRole('radio', { name: 'Use my Claude Code sign-in' }));
  const open = await screen.findByRole('button', { name: 'Open Terminal to sign in' });
  vi.useFakeTimers(); fireEvent.click(open); await act(async () => { await Promise.resolve(); });
  await act(async () => { vi.advanceTimersByTime(120_000); });
  expect(screen.getByText("Sign-in hasn't been detected yet. Finish in Terminal, then check again.")).toBeTruthy();
  const count = mocks.invoke.mock.calls.length;
  await act(async () => { vi.advanceTimersByTime(30_000); }); expect(mocks.invoke.mock.calls.length).toBe(count);
  unmount(); await act(async () => { vi.advanceTimersByTime(30_000); }); expect(mocks.invoke.mock.calls.length).toBe(count);
});
it('keeps newer connection events over a stale initial list', async () => {
  let resolve!: (value: AccountInfo[]) => void;
  mocks.invoke.mockImplementation(() => new Promise<AccountInfo[]>((done) => { resolve = done; }));
  render(<Accounts />);
  act(() => mocks.listeners.get('accounts.changed')?.([account('openai', { status: 'connected', method: 'api-key', keyPreview: '…1234' })]));
  await act(async () => resolve(accounts));
  expect(screen.getByText('Connected')).toBeTruthy(); expect(screen.getByText('…1234')).toBeTruthy();
});
