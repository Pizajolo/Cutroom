import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CutroomBridge } from '@shared/ipc/bridge';
import { App } from '../../src/renderer/App';
import { useNavigation } from '../../src/renderer/state/navigation';

beforeEach(() => {
  useNavigation.setState({ destination: 'home', tab: 'Editor', project: null, mediaFolder: null, recentProjects: [], goalDraft: '', goalFocusRequest: 0, sidebarCollapsed: false, settingsSection: 'Accounts' });
  const invoke = vi.fn<CutroomBridge['invoke']>();
  invoke.mockImplementation((async (channel: string) => ({ ok: true, data: channel === 'app.getInfo' ? { version: '0.1.0', platform: 'darwin', arch: 'arm64', homeDir: '/test/.cutroom', mediaBaseUrl: null, compBaseUrl: null } : [] })) as CutroomBridge['invoke']);
  window.cutroom = { invoke, on: vi.fn(() => () => {}), getPathForFile: vi.fn(() => '') };
});
afterEach(cleanup);

describe('renderer shell', () => {
  it('starts on Home, reads the real app version and navigates to Projects', async () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'What do you want to make?' })).toBeTruthy();
    await screen.findByText('v0.1.0');
    expect(window.cutroom.invoke).toHaveBeenCalledWith('app.getInfo', {});
    fireEvent.click(screen.getByRole('button', { name: 'Projects' }));
    expect(screen.getByRole('heading', { name: 'Projects' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'No recent projects loaded' })).toBeTruthy();
  });
  it('globally focuses the goal box and preserves its draft across navigation', async () => {
    render(<App />); const goal = screen.getByRole('textbox', { name: 'Describe your video' });
    fireEvent.change(goal, { target: { value: 'A 30-second coastal teaser' } });
    fireEvent.click(screen.getByRole('button', { name: 'Projects' }));
    fireEvent.keyDown(document.body, { key: 'n', metaKey: true });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Describe your video' })));
    expect((screen.getByRole('textbox', { name: 'Describe your video' }) as HTMLTextAreaElement).value).toBe('A 30-second coastal teaser');
  });
  it('renders the five project tabs for an already provided project session', async () => {
    useNavigation.getState().openProject({ rootPath: '/test/launch', project: {
      id: 'launch', name: 'Launch film', format: { aspect: '9:16', width: 1080, height: 1920, fps: 30 }, defaultEngine: 'hyperframes', createdAt: '2026-11-01T00:00:00.000Z',
      folderMap: { raw: 'raw', references: 'references', assets: 'assets', compositions: 'compositions', audio: 'audio', work: 'work', final: 'final' },
    } });
    render(<App />);
    expect(screen.getByRole('tablist', { name: 'Project' }).querySelectorAll('[role="tab"]').length).toBe(5);
    const editor = screen.getByRole('tab', { name: 'Editor' });
    expect(editor.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(editor, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Runs' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('heading', { name: 'Runs not connected' })).toBeTruthy();
  });
  it('shows an operational error and Retry when app info fails', async () => {
    vi.mocked(window.cutroom.invoke).mockResolvedValue({ ok: false, error: { code: 'internal', message: 'Desktop service unavailable.' } });
    render(<App />);
    await screen.findByText('Desktop service unavailable.');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});
