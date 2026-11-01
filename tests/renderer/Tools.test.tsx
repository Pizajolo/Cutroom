import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Tools } from '../../src/renderer/pages/Tools';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), on: vi.fn(() => () => {}) }));
vi.mock('../../src/renderer/lib/api', () => ({ api: mocks }));
beforeEach(() => { mocks.invoke.mockReset(); mocks.on.mockClear(); });
afterEach(cleanup);
it('shows verified status, source and pinned versions without pretending missing binaries are usable', async () => {
  mocks.invoke.mockResolvedValue([
    { name: 'ffmpeg', version: '7.1', path: '/bundle/ffmpeg', source: 'bundled', status: 'ok' },
    { name: 'ffprobe', version: '7.1', path: '/bundle/ffprobe', source: 'bundled', status: 'missing' },
    { name: 'whisper', version: '1.7', path: '/bundle/whisper', source: 'bundled', status: 'checksum_mismatch' },
    { name: 'yt-dlp', version: '2026.10', path: '/updated/yt-dlp', source: 'updated', status: 'ok' },
  ]);
  render(<Tools />); await screen.findByText('ffmpeg');
  expect(screen.getByText('Missing')).toBeTruthy(); expect(screen.getByText('Checksum mismatch')).toBeTruthy(); expect(screen.getByText('Updated')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Update', exact: true }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getAllByText('Status unavailable').length).toBe(4);
  expect(mocks.invoke).toHaveBeenCalledWith('tools.list', {});
});
it('retains a failure message and lets the user check again', async () => {
  mocks.invoke.mockRejectedValueOnce(new Error('The tools manifest could not be read.')).mockResolvedValueOnce([]);
  render(<Tools />); await screen.findByText('The tools manifest could not be read.');
  fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
  await screen.findByRole('table'); expect(mocks.invoke).toHaveBeenCalledTimes(2);
});
