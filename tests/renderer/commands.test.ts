import { beforeEach, describe, expect, it } from 'vitest';
import { timelineDoc, session } from './fixtures';
import { moveSelection, nudge, paste, selectedItems, split, trimSelection } from '../../src/renderer/editor/timeline/commands';
import { clearClipboard, copy, duplicate, pasteClipboard } from '../../src/renderer/editor/timeline/clipboard';
import { useNavigation } from '../../src/renderer/state/navigation';
import { applyOp } from '../../src/shared/timeline/ops';

beforeEach(clearClipboard);
const id = 'clip_0000000001';
describe('atomic timeline commands', () => {
  it('nudges on the frame grid and clamps the group at zero without changing offsets', () => {
    const doc = timelineDoc(); const video = doc.tracks.find((t) => t.kind === 'video')!;
    video.items[0]!.start = 1; video.items.push({ ...video.items[0]!, id: 'clip_0000000002', start: 8 });
    const ids = video.items.map((i) => i.id);
    expect(nudge(doc, ids, 1).ops).toEqual([{ type: 'moveItems', moves: [{ itemId: id, trackId: 'video', start: 31 / 30 }, { itemId: ids[1], trackId: 'video', start: 241 / 30 }] }]);
    expect(moveSelection(doc, ids, -20).ops).toEqual([{ type: 'moveItems', moves: [{ itemId: id, trackId: 'video', start: 0 }, { itemId: ids[1], trackId: 'video', start: 7 }] }]);
    expect(video.items[0]!.start).toBe(1);
  });
  it('moves a group to compatible tracks in a single operation and rejects all overlapping placements', () => {
    const doc = timelineDoc(); const video = doc.tracks.find((t) => t.kind === 'video')!, broll = doc.tracks.find((t) => t.kind === 'broll')!;
    video.items.push({ ...video.items[0]!, id: 'clip_0000000002', start: 6 });
    const result = moveSelection(doc, video.items.map((i) => i.id), 2, 1);
    expect(result.ops).toHaveLength(1); const moved = applyOp(doc, result.ops[0]!).doc;
    expect(moved.tracks.find((t) => t.id === 'broll')!.items.map((i) => i.start)).toEqual([2, 8]);
    broll.items.push({ ...video.items[0]!, id: 'clip_0000000003', start: 2 });
    expect(() => moveSelection(doc, [broll.items[0]!.id], 0, -1)).toThrow('Overlaps Video');
    expect(() => moveSelection(doc, [id], 0, 2)).toThrow('accepts audio');
    expect(video.items).toHaveLength(2);
  });
  it('skips locked sources with a note and refuses locked destinations', () => {
    const doc = timelineDoc(); const video = doc.tracks.find((t) => t.kind === 'video')!; video.locked = true;
    expect(nudge(doc, [id], 1)).toEqual({ ops: [], note: "1 locked clip wasn't changed." });
    expect(duplicate(doc, [id])).toEqual({ ops: [], note: "1 locked clip wasn't changed." });
    video.locked = false; doc.tracks.find((t) => t.kind === 'broll')!.locked = true;
    expect(() => moveSelection(doc, [id], 0, 1)).toThrow('locked');
  });
  it('pastes relative timing and source trims with new provenance, failing atomically on overlap', () => {
    const doc = timelineDoc(); const video = doc.tracks.find((t) => t.kind === 'video')!;
    video.items.push({ ...video.items[0]!, id: 'clip_0000000002', start: 8 });
    const copied = selectedItems(doc, video.items.map((i) => i.id));
    const result = paste(doc, copied, 20, ['clip_0000000003', 'clip_0000000004']);
    expect(result.ops).toHaveLength(2);
    expect(result.ops[0]).toMatchObject({ type: 'addItem', item: { start: 20, in: 2, out: 7, createdBy: 'user', userEdited: [] } });
    expect(result.ops[1]).toMatchObject({ item: { start: 28 } });
    expect(() => paste(doc, copied, 3, ['clip_0000000003', 'clip_0000000004'])).toThrow('Overlaps Video');
    expect(video.items).toHaveLength(2);
  });
  it('splits all unlocked tracks at a quantized time, excluding one-frame and outside boundaries', () => {
    const doc = timelineDoc(); const clip = doc.tracks.find((t) => t.kind === 'video')!.items[0]!;
    const broll = doc.tracks.find((t) => t.kind === 'broll')!; broll.items = [{ ...clip, id: 'clip_0000000002' }]; broll.locked = true;
    expect(split(doc, [], 1.51, true)).toEqual({ ops: [{ type: 'splitItem', itemId: id, at: 1.5 }], note: "1 locked clip wasn't changed." });
    expect(split(doc, [id], .01).ops).toEqual([]);
    expect(trimSelection(doc, [id], 10, 'start', true).ops).toEqual([]);
  });
  it('duplicates after the bounding end and clears project-relative clipboard on project change', () => {
    const doc = timelineDoc(); expect(duplicate(doc, [id]).ops[0]).toMatchObject({ type: 'addItem', item: { start: 5, in: 2 } });
    useNavigation.setState({ project: session }); copy(doc, [id]);
    expect(pasteClipboard(doc, 10).ops).toHaveLength(1);
    useNavigation.setState({ project: null }); expect(pasteClipboard(doc, 10).ops).toEqual([]);
  });
});
