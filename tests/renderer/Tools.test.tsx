import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ToolInfo } from '@shared/schema/media';
import type { WhisperModelInfo } from '@shared/schema/models';
import { Tools } from '../../src/renderer/pages/Tools';
import { setupProgress } from '../../src/renderer/lib/useTools';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listeners: new Map<string, (payload: unknown) => void>() }));
vi.mock('../../src/renderer/lib/api', () => ({ api: { invoke: mocks.invoke, on: (event: string, listener: (payload: unknown) => void) => { mocks.listeners.set(event, listener); return () => mocks.listeners.delete(event); } } }));
const tool = (patch: Partial<ToolInfo> = {}): ToolInfo => ({ name: 'ffmpeg', version: '7.1', path: '/bundle/ffmpeg', source: 'bundled', status: 'ok', verification: 'pinned', install: null, updatable: false, latestVersion: null, hint: null, ...patch });
const model = (patch: Partial<WhisperModelInfo> = {}): WhisperModelInfo => ({ name: 'base', sizeBytes: 148_000_000, status: 'installed', install: null, isDefault: true, ...patch });
let tools: ToolInfo[];
let models: WhisperModelInfo[];
beforeEach(() => {
  mocks.invoke.mockReset(); mocks.listeners.clear();
  tools = [tool(), tool({ name: 'ffprobe', status: 'missing', verification: null }), tool({ name: 'whisper-cli', status: 'missing', hint: 'Build whisper-cli with cmake and Xcode Command Line Tools.' }), tool({ name: 'yt-dlp', source: 'updated', updatable: true })];
  models = [model(), model({ name: 'small', status: 'missing', sizeBytes: 488_000_000, isDefault: false })];
  mocks.invoke.mockImplementation(async (channel: string) => channel === 'tools.list' ? tools : channel === 'models.list' ? models : { ok: true });
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(cleanup);
it('shows verified tools, source, build hints and independently installed models', async () => {
  render(<Tools />); await screen.findByText('ffmpeg');
  expect(screen.getByText('Updated')).toBeTruthy(); expect(screen.getAllByText('Pinned checksum')).toHaveLength(3);
  expect(screen.getByText('Not verified yet')).toBeTruthy(); expect(screen.getByText('Build required')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Install whisper-cli' })).toBeNull();
  expect(screen.getByText('Installed')).toBeTruthy(); expect(screen.getByText('Not downloaded')).toBeTruthy();
  expect(screen.getByText('148 MB')).toBeTruthy(); expect(screen.getByText('488 MB')).toBeTruthy();
  const select = screen.getByRole('combobox', { name: 'Default transcription model' }) as HTMLSelectElement;
  expect(select.disabled).toBe(false); expect([...select.options].map((option) => option.value)).toEqual(['base']);
});
it.each(['queued', 'downloading', 'verifying', 'installing'] as const)('gives %s precedence over missing and updates live to OK', async (state) => {
  tools = [tool({ status: 'missing', install: { state, received: 25_000_000, total: 100_000_000 } })];
  render(<Tools />); const progress = await screen.findByRole('progressbar', { name: 'ffmpeg download' });
  expect(progress.getAttribute('aria-valuenow')).toBe(state === 'downloading' ? '25' : null);
  expect(screen.queryByText('Not installed')).toBeNull();
  if (state === 'downloading') {
    expect(screen.getByText('25.0 / 100.0 MB')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel ffmpeg download' }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('tools.cancelInstall', { name: 'ffmpeg' }));
  }
  act(() => mocks.listeners.get('tools.changed')?.([tool()]));
  expect(screen.getByText('OK')).toBeTruthy(); expect(screen.queryByRole('progressbar')).toBeNull();
});
it('shows indeterminate progress when the total is unknown and failed rows offer Retry', async () => {
  tools = [tool({ status: 'missing', install: { state: 'downloading', received: 12_000_000, total: null } })];
  render(<Tools />); const progress = await screen.findByRole('progressbar', { name: 'ffmpeg download' });
  expect(progress.getAttribute('aria-valuenow')).toBeNull(); expect(screen.getByText('12.0 MB downloaded')).toBeTruthy();
  act(() => mocks.listeners.get('tools.changed')?.([tool({ status: 'missing', install: { state: 'failed', received: 12_000_000, total: null, error: 'Download unavailable: offline.' } })]));
  expect(screen.getByText('Download unavailable: offline.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Retry ffmpeg' }));
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('tools.install', { name: 'ffmpeg' }));
});
it.each(['tool', 'model'] as const)('keeps Cancel usable while the %s installation request is pending', async (kind) => {
  tools = [tool({ status: 'missing' })];
  models = [model({ status: 'missing' })];
  let complete!: () => void;
  const installation = new Promise<{ ok: true }>((resolve) => { complete = () => resolve({ ok: true }); });
  mocks.invoke.mockImplementation((channel: string) => channel === 'tools.list' ? Promise.resolve(tools) : channel === 'models.list' ? Promise.resolve(models) : channel === 'tools.install' || channel === 'models.download' ? installation : Promise.resolve({ ok: true }));
  render(<Tools />);
  fireEvent.click(await screen.findByRole('button', { name: kind === 'tool' ? 'Install ffmpeg' : 'Download base model' }));
  act(() => mocks.listeners.get(kind === 'tool' ? 'tools.changed' : 'models.changed')?.(kind === 'tool' ? [tool({ status: 'missing', install: { state: 'downloading', received: 10, total: 100 } })] : [model({ status: 'missing', install: { state: 'downloading', received: 10, total: 100 } })]));
  const cancel = screen.getByRole('button', { name: kind === 'tool' ? 'Cancel ffmpeg download' : 'Cancel base model download' }) as HTMLButtonElement;
  expect(cancel.disabled).toBe(false); fireEvent.click(cancel);
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith(kind === 'tool' ? 'tools.cancelInstall' : 'models.cancel', { name: kind === 'tool' ? 'ffmpeg' : 'base' }));
  await act(async () => complete());
});
it('checks yt-dlp updates, installs a new version and reports up to date', async () => {
  tools = [tool({ name: 'yt-dlp', version: '2026.10', updatable: true })];
  mocks.invoke.mockImplementation(async (channel: string) => channel === 'tools.list' ? tools : channel === 'models.list' ? models : channel === 'tools.checkUpdate' ? { current: '2026.10', latest: '2026.11' } : { ok: true });
  render(<Tools />); fireEvent.click(await screen.findByRole('button', { name: 'Check for updates' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Update to 2026.11' }));
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('tools.update', { name: 'yt-dlp' }));
  act(() => mocks.listeners.get('tools.changed')?.([tool({ name: 'yt-dlp', version: '2026.11', source: 'updated', updatable: true })]));
  expect(screen.getByText('Updated')).toBeTruthy(); expect(screen.getByText('2026.11')).toBeTruthy();
  mocks.invoke.mockResolvedValue({ current: '2026.11', latest: null });
  fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
  await screen.findByText('Up to date');
});
it('downloads/cancels models, confirms deletion and changes default only to an installed model', async () => {
  render(<Tools />); fireEvent.click(await screen.findByRole('button', { name: 'Download small model' }));
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('models.download', { name: 'small' }));
  const small = model({ name: 'small', isDefault: false, status: 'missing', install: { state: 'downloading', received: 10_000_000, total: 488_000_000 } });
  act(() => mocks.listeners.get('models.changed')?.([model(), small]));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel small model download' }));
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('models.cancel', { name: 'small' }));
  act(() => mocks.listeners.get('models.changed')?.([model(), { ...small, status: 'installed', install: null }]));
  mocks.invoke.mockResolvedValue([model({ isDefault: false }), { ...small, status: 'installed', install: null, isDefault: true }]);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'small' } });
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('models.setDefault', { name: 'small' }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete small model' }));
  const dialog = screen.getByRole('dialog', { name: 'Delete small model?' });
  expect(mocks.invoke).not.toHaveBeenCalledWith('models.delete', { name: 'small' });
  expect(within(dialog).getByText('This is your default model. Transcription will need an installed model.')).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete model' }));
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('models.delete', { name: 'small' }));
});
it('does not restart a deliberately deleted default download or silently choose another model on remount', async () => {
  models = [model(), model({ name: 'small', isDefault: false })];
  mocks.invoke.mockImplementation(async (channel: string) => {
    if (channel === 'tools.list') return tools;
    if (channel === 'models.list') return models;
    if (channel === 'models.delete') {
      models = [model({ status: 'missing' }), model({ name: 'small', isDefault: false })];
      mocks.listeners.get('models.changed')?.(models);
    }
    return { ok: true };
  });
  const { unmount } = render(<Tools />);
  fireEvent.click(await screen.findByRole('button', { name: 'Delete base model' }));
  const dialog = screen.getByRole('dialog', { name: 'Delete base model?' });
  expect(within(dialog).getByText('This is your default model. Transcription will need an installed model.')).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete model' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByRole('button', { name: 'Download base model' })).toBeTruthy();
  expect(screen.getByText('Current default: base (not installed).')).toBeTruthy();
  unmount(); render(<Tools />);
  await screen.findByRole('button', { name: 'Download base model' });
  const select = screen.getByRole('combobox', { name: 'Default transcription model' }) as HTMLSelectElement;
  expect(select.value).toBe(''); expect([...select.options].map((option) => option.value)).toEqual(['', 'small']);
  expect(mocks.invoke).toHaveBeenCalledWith('models.delete', { name: 'base' });
  expect(mocks.invoke.mock.calls.filter(([channel]) => channel === 'models.download' || channel === 'models.setDefault')).toEqual([]);
});
it('does not let a late fetch overwrite a newer event', async () => {
  let resolve!: (value: ToolInfo[]) => void;
  mocks.invoke.mockImplementation((channel: string) => channel === 'tools.list' ? new Promise<ToolInfo[]>((done) => { resolve = done; }) : Promise.resolve(models));
  render(<Tools />);
  act(() => mocks.listeners.get('tools.changed')?.([tool({ version: 'new-version' })]));
  await act(async () => resolve([tool({ version: 'stale-version' })]));
  expect(screen.getByText('new-version')).toBeTruthy(); expect(screen.queryByText('stale-version')).toBeNull();
});
it('retains fetch errors and lets the user retry', async () => {
  mocks.invoke.mockRejectedValueOnce(new Error('The tools manifest could not be read.')).mockResolvedValueOnce(models);
  render(<Tools />); await screen.findByText('The tools manifest could not be read.');
  mocks.invoke.mockResolvedValue(tools);
  fireEvent.click(screen.getByRole('button', { name: 'Retry tools check' }));
  await screen.findByRole('table');
});
it('aggregates bytes rather than percentages, excluding optional models and build prerequisites', () => {
  const download = (received: number, total: number | null) => ({ state: 'downloading' as const, received, total });
  expect(setupProgress([tool({ install: download(50, 100) }), tool({ install: download(0, 900) })], [model({ isDefault: false, install: download(999, 1000) })])).toEqual({ busy: true, failed: false, percent: 5 });
  expect(setupProgress([tool({ install: download(50, null) })], [])).toEqual({ busy: true, failed: false, percent: undefined });
  expect(setupProgress([tool({ status: 'missing', hint: 'Build required' })], [])).toEqual({ busy: false, failed: false, percent: undefined });
});
