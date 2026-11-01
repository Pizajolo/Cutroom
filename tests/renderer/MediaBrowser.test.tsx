import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaFile } from '@shared/schema/media';
import { BrowseMediaButton, MediaBrowser } from '../../src/renderer/media/MediaBrowser';
import { MEDIA_DRAG_TYPE } from '../../src/renderer/media/types';
import { useNavigation } from '../../src/renderer/state/navigation';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn<(channel: string, request: unknown) => Promise<unknown>>(),
  path: vi.fn<(file: File) => string>(),
  listeners: new Map<string, (payload: unknown) => void>(),
}));
vi.mock('../../src/renderer/lib/api', () => ({ api: {
  invoke: mocks.invoke,
  getPathForFile: mocks.path,
  on: (name: string, listener: (payload: unknown) => void) => { mocks.listeners.set(name, listener); return () => { mocks.listeners.delete(name); }; },
} }));
const folder = { id: 'folder-1', root: '/test/coast' };
const clip = (rel: string): MediaFile => ({ rel, name: rel.split('/').pop() ?? rel, kind: 'video', url: `http://127.0.0.1:1234/k/test/p/folder-1/${rel}`,
  probe: { duration: 12.5, width: 1920, height: 1080, fps: 30, vcodec: 'h264', acodec: 'aac', channels: 2, sampleRate: 48000, bitrate: 2000000, size: 3125000, hasAlpha: false },
});
let files: MediaFile[];
beforeEach(() => {
  files = [clip('raw/coast.mp4'), clip('raw/path.mp4'), clip('final/teaser-v1.mp4')];
  mocks.listeners.clear(); mocks.invoke.mockReset(); mocks.path.mockReset();
  mocks.invoke.mockImplementation(async (channel) => {
    if (channel === 'media.list') return files;
    if (channel === 'media.thumbnails') return { imageRel: 'work/thumbs.jpg', imageUrl: 'http://127.0.0.1:1234/thumbs.jpg', interval: 1, frameWidth: 160, frameHeight: 90, columns: 1, rows: 1, count: 1, frames: [{ time: 0, x: 0, y: 0, w: 160, h: 90 }] };
    if (channel === 'media.selectProjectFolder') return folder;
    if (channel === 'media.importDialog' || channel === 'media.importPaths') { const added = clip('raw/new.mp4'); files = [...files, added]; return [added]; }
    throw new Error(`Unexpected fixture channel: ${channel}`);
  });
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(cleanup);

describe('media folder browser', () => {
  it('groups files, renders real metadata and identifies source protections and empty sections', async () => {
    render(<MediaBrowser folder={folder} />);
    const footage = await screen.findByRole('region', { name: 'Footage' });
    await within(footage).findByRole('button', { name: 'Preview coast.mp4' });
    expect(within(footage).getAllByText('Read-only for agents').length).toBe(1);
    expect(within(footage).getAllByText('1920 × 1080').length).toBe(2);
    expect(within(footage).getAllByText('0:12').length).toBe(2);
    expect(within(screen.getByRole('region', { name: 'Exports' })).getByRole('button', { name: 'Preview teaser-v1.mp4' })).toBeTruthy();
    expect(screen.getByText('No generated audio yet.')).toBeTruthy();
    expect(mocks.invoke).toHaveBeenCalledWith('media.thumbnails', { rel: 'raw/coast.mp4' });
  });
  it('opens native inline playback when a card is clicked', async () => {
    const { container } = render(<MediaBrowser folder={folder} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Preview coast.mp4' }));
    const video = container.querySelector('video'); expect(video?.getAttribute('src')).toBe(files[0]?.url); expect(video?.hasAttribute('controls')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Close source player' })); expect(container.querySelector('video')).toBeNull();
  });
  it('imports into raw by default and refreshes without remounting', async () => {
    render(<MediaBrowser folder={folder} />); await screen.findByRole('button', { name: 'Preview coast.mp4' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Import files', exact: true })[0]!);
    expect((screen.getByRole('combobox', { name: 'Destination' }) as HTMLSelectElement).value).toBe('raw');
    fireEvent.click(screen.getByRole('button', { name: 'Choose files' }));
    await screen.findByRole('button', { name: 'Preview new.mp4' });
    expect(mocks.invoke).toHaveBeenCalledWith('media.importDialog', { destination: 'raw' });
  });
  it('obtains File grants immediately before importing a confirmed Finder drop', async () => {
    mocks.path.mockReturnValue('/dropped/new.mp4'); const file = new File(['video'], 'new.mp4');
    render(<MediaBrowser folder={folder} />); await screen.findByRole('button', { name: 'Preview coast.mp4' });
    fireEvent.drop(screen.getByRole('region', { name: 'Footage' }), { dataTransfer: { types: ['Files'], files: [file] } });
    expect(mocks.path).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 file' }));
    await screen.findByRole('button', { name: 'Preview new.mp4' });
    expect(mocks.path).toHaveBeenCalledWith(file);
    expect(mocks.invoke).toHaveBeenCalledWith('media.importPaths', { paths: ['/dropped/new.mp4'], destination: 'raw' });
  });
  it('does not import a dropped file when its one-use path grant is unavailable', async () => {
    mocks.path.mockReturnValue('');
    render(<MediaBrowser folder={folder} />); await screen.findByRole('button', { name: 'Preview coast.mp4' });
    fireEvent.drop(screen.getByRole('region', { name: 'Footage' }), { dataTransfer: { types: ['Files'], files: [new File(['video'], 'new.mp4')] } });
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 file' }));
    await screen.findByText('The dropped files could not be located. Use Import files instead.');
    expect(mocks.invoke.mock.calls.some(([channel]) => channel === 'media.importPaths')).toBe(false);
  });
  it('discards a cancelled drop before a later native import', async () => {
    render(<MediaBrowser folder={folder} />); await screen.findByRole('button', { name: 'Preview coast.mp4' });
    fireEvent.drop(screen.getByRole('region', { name: 'Footage' }), { dataTransfer: { types: ['Files'], files: [new File(['video'], 'unused.mp4')] } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Import files', exact: true })[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Choose files' }));
    await screen.findByRole('button', { name: 'Preview new.mp4' });
    expect(mocks.path).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledWith('media.importDialog', { destination: 'raw' });
  });
  it('encodes only a project-relative source in the timeline drag', async () => {
    render(<MediaBrowser folder={folder} />); const card = await screen.findByRole('button', { name: 'Preview coast.mp4' }); const setData = vi.fn();
    fireEvent.dragStart(card, { dataTransfer: { setData } });
    expect(setData).toHaveBeenCalledWith(MEDIA_DRAG_TYPE, JSON.stringify({ rel: 'raw/coast.mp4' }));
  });
  it('refreshes only for the selected folder and removes subscriptions on unmount', async () => {
    const { unmount } = render(<MediaBrowser folder={folder} />); await screen.findByRole('button', { name: 'Preview coast.mp4' });
    const before = mocks.invoke.mock.calls.filter(([channel]) => channel === 'media.list').length;
    mocks.listeners.get('media.changed')?.({ projectId: 'different-folder', rels: [] });
    expect(mocks.invoke.mock.calls.filter(([channel]) => channel === 'media.list').length).toBe(before);
    mocks.listeners.get('media.changed')?.({ projectId: folder.id, rels: [] });
    await waitFor(() => expect(mocks.invoke.mock.calls.filter(([channel]) => channel === 'media.list').length).toBe(before + 1));
    unmount(); expect(mocks.listeners.size).toBe(0);
  });
  it('keeps browsing separate from project creation', async () => {
    render(<BrowseMediaButton />); fireEvent.click(screen.getByRole('button', { name: 'Browse media folder' }));
    await waitFor(() => expect(useNavigation.getState().mediaFolder).toEqual(folder));
    expect(useNavigation.getState().destination).toBe('media');
    expect(mocks.invoke).toHaveBeenCalledWith('media.selectProjectFolder', {});
  });
});
