import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TRACK_KINDS, type TimelineDoc, type TimelineItem } from '@shared/schema/timeline';
import { Timeline, TRACK_NAMES, type ApplyTimeline } from '../../src/renderer/editor/timeline/Timeline';
import { previewClock } from '../../src/renderer/editor/preview/store';
import { useSelection } from '../../src/renderer/editor/selection/store';
import { keymap } from '../../src/renderer/lib/keymap';

function fixture(): TimelineDoc {
  const clip = (id: string, start: number, src: string): TimelineItem => ({
    id, type: 'clip', src, start, duration: 2, in: 0, out: 2, speed: 1, volume: 1,
    muted: false, createdBy: 'user', userEdited: [],
  });
  return {
    version: 1, format: { aspect: '16:9', width: 1920, height: 1080, fps: 30 }, markers: [],
    tracks: TRACK_KINDS.map((kind) => ({ id: kind, kind, name: TRACK_NAMES[kind], muted: false, solo: false,
      items: kind === 'video' ? [clip('clip_0000000001', 1, 'raw/first.mp4'), clip('clip_0000000002', 4, 'raw/second.mp4')] : [],
    })),
  };
}

beforeEach(() => {
  useSelection.getState().clear();
  previewClock.configure(10, 30); previewClock.seek(0);
  keymap.setScopes([]);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200);
});
afterEach(() => { cleanup(); previewClock.pause(); keymap.setScopes([]); vi.restoreAllMocks(); });

describe('timeline foundation', () => {
  it('toggles snapping by button and the scoped N shortcut', () => {
    render(<Timeline doc={fixture()} />); const snapping = screen.getByRole('button', { name: 'Snapping' });
    expect(snapping.getAttribute('aria-pressed')).toBe('true'); fireEvent.click(snapping); expect(snapping.getAttribute('aria-pressed')).toBe('false');
    const detach = keymap.attach(); keymap.setScopes(['editor']);
    try { fireEvent.keyDown(document.body, { key: 'n' }); expect(snapping.getAttribute('aria-pressed')).toBe('true'); } finally { detach(); }
  });
  it('renders eight fixed tracks and disables edits without an operation callback', () => {
    const { container } = render(<Timeline doc={null} />);
    expect([...container.querySelectorAll('[data-track-kind]')].map((element) => element.getAttribute('data-track-kind'))).toEqual([...TRACK_KINDS]);
    for (const kind of TRACK_KINDS) {
      expect((screen.getByRole('button', { name: `Mute ${TRACK_NAMES[kind]}` }) as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByRole('button', { name: `Solo ${TRACK_NAMES[kind]}` }) as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.getByText('Loading timeline…')).toBeTruthy();
  });
  it('shares selection, supports Shift-click toggles and clears with Escape', async () => {
    render(<Timeline doc={fixture()} />);
    const first = await screen.findByRole('button', { name: /first\.mp4, Video/ });
    const second = await screen.findByRole('button', { name: /second\.mp4, Video/ });
    fireEvent.click(first); fireEvent.click(second, { shiftKey: true });
    expect(useSelection.getState().elements).toEqual([{ itemId: 'clip_0000000001' }, { itemId: 'clip_0000000002' }]);
    expect(first.getAttribute('aria-pressed')).toBe('true'); expect(second.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(second, { shiftKey: true }); expect(useSelection.getState().elements).toHaveLength(1);
    fireEvent.keyDown(first, { key: 'Escape' }); expect(useSelection.getState().elements).toEqual([]);
  });
  it('sends exactly one setTrack operation and surfaces a rejected operation', async () => {
    const apply = vi.fn<ApplyTimeline>().mockResolvedValue(undefined);
    const onError = vi.fn(); render(<Timeline doc={fixture()} apply={apply} onError={onError} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mute Video (main)' }));
    expect(apply).toHaveBeenCalledExactlyOnceWith([{ type: 'setTrack', trackId: 'video', muted: true }], 'Mute Video (main)');
    apply.mockRejectedValueOnce(new Error('The timeline changed. Refresh and try again.'));
    fireEvent.click(screen.getByRole('button', { name: 'Solo Music' }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith('The timeline changed. Refresh and try again.'));
  });
  it('steps the clock from the ruler and scopes zoom shortcuts to timeline focus', async () => {
    render(<Timeline doc={fixture()} />);
    const ruler = screen.getByRole('group', { name: /Time ruler/ });
    fireEvent.keyDown(ruler, { key: 'ArrowRight' }); expect(previewClock.getSnapshot().time).toBeCloseTo(1 / 30);
    fireEvent.keyDown(ruler, { key: 'ArrowRight', shiftKey: true }); expect(previewClock.getSnapshot().time).toBeCloseTo(11 / 30);
    fireEvent.keyDown(ruler, { key: 'End' }); expect(previewClock.getSnapshot().time).toBe(6);
    fireEvent.keyDown(ruler, { key: 'Home' }); expect(previewClock.getSnapshot().time).toBe(0);
    const detach = keymap.attach();
    try {
      fireEvent.focus(ruler);
      fireEvent.keyDown(ruler, { key: '=', metaKey: true });
      await waitFor(() => expect((screen.getByRole('slider', { name: 'Timeline zoom' }) as HTMLInputElement).value).toBe('7'));
      fireEvent.blur(ruler, { relatedTarget: document.body });
      fireEvent.keyDown(document.body, { key: '=', metaKey: true });
      expect((screen.getByRole('slider', { name: 'Timeline zoom' }) as HTMLInputElement).value).toBe('7');
    } finally { detach(); }
  });
});
