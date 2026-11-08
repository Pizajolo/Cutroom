import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ResizeSeparator } from '../../src/renderer/components/ResizeSeparator';
import { jumpEdit, jumpSeconds, toggleLoop, setBoundary } from '../../src/renderer/editor/timeline/navigation';
import { previewClock } from '../../src/renderer/editor/preview/store';
import { useSelection } from '../../src/renderer/editor/selection/store';
import { useEditor } from '../../src/renderer/editor/store';
import { timelineDoc } from './fixtures';
vi.mock('../../src/renderer/lib/api', () => ({ api: { invoke: vi.fn(), on: () => () => {} } }));
beforeEach(() => { useSelection.getState().clear(); previewClock.setLoop(null); previewClock.configure(20, 30); previewClock.seek(0); useEditor.setState({ timeline: { doc: timelineDoc(), revision: 1, canUndo: false, canRedo: false } }); });
afterEach(cleanup);
it('jumps across track edit boundaries and markers and clamps second jumps', () => {
  const doc = timelineDoc(); doc.tracks.find((t) => t.id === 'broll')!.items = [{ ...doc.tracks.find((t) => t.id === 'video')!.items[0]!, id: 'clip_0000000002', start: 2 }];
  doc.markers = [{ id: 'marker_0000000001', time: 3, label: 'Opening', kind: 'marker' }]; useEditor.setState({ timeline: { doc, revision: 1, canUndo: false, canRedo: false } });
  jumpEdit(1); expect(previewClock.getSnapshot().time).toBe(2); jumpEdit(1); expect(previewClock.getSnapshot().time).toBe(5); jumpEdit(-1, true); expect(previewClock.getSnapshot().time).toBe(3);
  jumpSeconds(-5); expect(previewClock.getSnapshot().time).toBe(0); jumpSeconds(1); expect(previewClock.getSnapshot().time).toBe(1);
});
it('normalizes backward In/Out, tracks active range changes and tolerates ranges beyond the edit', () => {
  previewClock.seek(8); setBoundary('start'); previewClock.seek(2); setBoundary('end'); expect(useSelection.getState().range).toEqual({ start: 2, end: 8 });
  toggleLoop(); expect(previewClock.getSnapshot().loop).toEqual({ start: 2, end: 8 });
  useSelection.getState().setRange(30, 40); expect(previewClock.getSnapshot().loop).toEqual({ start: 0, end: 20 });
  useSelection.getState().clear(); expect(previewClock.getSnapshot().loop).toEqual({ start: 0, end: 20 });
  toggleLoop(); expect(previewClock.getSnapshot().loop).toBeNull();
});
function Splitter({ horizontal = false }: { horizontal?: boolean }) { const [value, setValue] = useState(380); return <ResizeSeparator label="Panel size" value={value} min={320} max={520} initial={380} horizontal={horizontal} onChange={setValue} />; }
it('resizes chat with arrows, larger steps, limits and reset using an accessible separator', () => {
  render(<Splitter />); const separator = screen.getByRole('separator', { name: 'Panel size' });
  expect(separator.getAttribute('aria-orientation')).toBe('vertical');
  fireEvent.keyDown(separator, { key: 'ArrowRight' }); expect(separator.getAttribute('aria-valuenow')).toBe('388');
  fireEvent.keyDown(separator, { key: 'ArrowLeft', shiftKey: true }); expect(separator.getAttribute('aria-valuenow')).toBe('356');
  fireEvent.keyDown(separator, { key: 'Home' }); expect(separator.getAttribute('aria-valuenow')).toBe('320');
  fireEvent.keyDown(separator, { key: 'End' }); expect(separator.getAttribute('aria-valuenow')).toBe('520');
  fireEvent.doubleClick(separator); expect(separator.getAttribute('aria-valuenow')).toBe('380');
});
it('grows the timeline upward with the horizontal separator', () => {
  render(<Splitter horizontal />); const separator = screen.getByRole('separator'); fireEvent.keyDown(separator, { key: 'ArrowUp' }); expect(separator.getAttribute('aria-valuenow')).toBe('388');
});
