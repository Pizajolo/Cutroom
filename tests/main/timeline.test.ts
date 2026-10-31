import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { timelineDocSchema, type TimelineDoc, type TimelineItem } from '@shared/schema';
import { applyOp, applyOps, historyOpSchema, opSchema, itemsAt, timelineDuration, frameOf, type Op, TimelineError } from '@shared/timeline/ops';
import sample from '../../src/shared/schema/__fixtures__/timeline.sample.json';

const clipId = 'clip_footage001';
const compositionId = 'composition_intro00001';
const doc = (): TimelineDoc => timelineDocSchema.parse(structuredClone(sample));
function item(document: TimelineDoc, id = clipId): TimelineItem {
  const found = document.tracks.flatMap((track) => track.items).find((entry) => entry.id === id);
  if (!found) throw new Error('Test item missing'); return found;
}
function newClip(): TimelineItem { return { ...item(doc()), id: 'clip_footage002', start: 10 }; }
function expectError(action: () => unknown, code: string): void {
  try { action(); expect.fail('Expected timeline error'); } catch (error) { expect(error).toBeInstanceOf(TimelineError); expect(error).toMatchObject({ code }); }
}
const marker = { id: 'marker-1', time: 1, kind: 'marker' as const, label: 'Beat' };

const successful: [string, () => TimelineDoc, Op][] = [
  ['addItem', doc, { type: 'addItem', trackId: 'video', item: newClip() }],
  ['moveItem', doc, { type: 'moveItem', itemId: clipId, start: 5, trackId: 'broll' }],
  ['trimItem start', doc, { type: 'trimItem', itemId: clipId, edge: 'start', time: 2 }],
  ['trimItem end', doc, { type: 'trimItem', itemId: clipId, edge: 'end', time: 8 }],
  ['splitItem', doc, { type: 'splitItem', itemId: clipId, at: 3 }],
  ['deleteItem', doc, { type: 'deleteItem', itemId: clipId }],
  ['rippleDelete', () => applyOp(doc(), { type: 'addItem', trackId: 'video', item: newClip() }).doc, { type: 'rippleDelete', itemId: clipId }],
  ['insertGap', doc, { type: 'insertGap', trackId: 'video', at: 0, duration: 2 }],
  ['reorderItem', doc, { type: 'reorderItem', itemId: clipId, index: 0 }],
  ['setProps', doc, { type: 'setProps', itemId: compositionId, patch: { props: { 'title-1': { text: 'Updated', size: 72 } } } }],
  ['setTrack', doc, { type: 'setTrack', trackId: 'video', muted: true, solo: true, name: 'Main footage' }],
  ['setFormat', doc, { type: 'setFormat', format: { fps: 24, width: 1080, height: 1920, aspect: '9:16' } }],
  ['addMarker', doc, { type: 'addMarker', marker }],
  ['updateMarker', () => ({ ...doc(), markers: [marker] }), { type: 'updateMarker', markerId: marker.id, patch: { time: 2, label: 'New beat' } }],
  ['deleteMarker', () => ({ ...doc(), markers: [marker] }), { type: 'deleteMarker', markerId: marker.id }],
];

describe('immutable timeline operations', () => {
  it.each(successful)('%s succeeds and its inverse restores the exact original', (_name, create, op) => {
    const original = create(); const before = structuredClone(original);
    const result = applyOp(original, op);
    expect(original).toEqual(before); expect(result.doc).not.toBe(original);
    expect(applyOps(result.doc, result.inverse).doc).toEqual(before);
  });
  it('quantizes positions and durations to the frame grid', () => {
    const result = applyOp(doc(), { type: 'moveItem', itemId: clipId, start: 0.042 });
    expect(item(result.doc).start).toBe(1 / 30);
  });
  it('splits on an exact frame boundary and preserves source in/out', () => {
    const result = applyOp(doc(), { type: 'splitItem', itemId: clipId, at: 31 / 30 });
    const clips = result.doc.tracks[3]?.items ?? [];
    expect(clips).toHaveLength(2);
    expect(clips[0]).toMatchObject({ duration: 31 / 30, in: 0, out: 31 / 30 });
    expect(clips[1]).toMatchObject({ start: 31 / 30, in: 31 / 30, out: 10 });
  });
  it('clamps trims to available source duration', () => {
    const result = applyOp(doc(), { type: 'trimItem', itemId: clipId, edge: 'end', time: 30 }, { sourceDurations: { 'raw/clip.mp4': 12 } });
    expect(item(result.doc)).toMatchObject({ duration: 12, out: 12 });
  });
  it('adjusts source seconds using clip speed', () => {
    const original = doc(); const clip = item(original);
    if (clip.type !== 'clip') throw new Error('Expected clip'); clip.speed = 2; clip.out = 20;
    const result = applyOp(original, { type: 'trimItem', itemId: clipId, edge: 'start', time: 2 });
    expect(item(result.doc)).toMatchObject({ start: 2, duration: 8, in: 4, out: 20 });
  });
  it('rejects overlap on video and voiceover, permits it on overlay', () => {
    const overlapping = { ...newClip(), start: 1 };
    expectError(() => applyOp(doc(), { type: 'addItem', trackId: 'video', item: overlapping }), 'overlap');
    const voice = applyOp(doc(), { type: 'addItem', trackId: 'voiceover', item: { ...item(doc()), id: 'clip_voice00001' } }).doc;
    expectError(() => applyOp(voice, { type: 'addItem', trackId: 'voiceover', item: overlapping }), 'overlap');
    expect(applyOp(doc(), { type: 'addItem', trackId: 'overlay', item: overlapping }).doc.tracks[0]?.items).toHaveLength(2);
  });
  it('ripple deletion shifts later items only on the same track', () => {
    const original = applyOp(doc(), { type: 'addItem', trackId: 'video', item: newClip() }).doc;
    const result = applyOp(original, { type: 'rippleDelete', itemId: clipId });
    expect(item(result.doc, 'clip_footage002').start).toBe(0);
    expect(item(result.doc, compositionId).start).toBe(0);
  });
  it('merges composition props per cutId, preserving other values', () => {
    const result = applyOp(doc(), { type: 'setProps', itemId: compositionId, patch: { props: { 'title-1': { text: 'New' } } } });
    expect(item(result.doc, compositionId)).toMatchObject({ props: { 'title-1': { text: 'New', color: '#ffffff' } } });
    expect(result.changed.paths).toContain(`items.${compositionId}.props.title-1.text`);
  });
  it('applies a batch atomically or not at all', () => {
    const original = doc(); const before = structuredClone(original);
    expectError(() => applyOps(original, [
      { type: 'moveItem', itemId: clipId, start: 2 },
      { type: 'deleteItem', itemId: 'clip_missing000' },
    ]), 'not_found');
    expect(original).toEqual(before);
  });
  it('preserves a later edit to a different item when reverting an earlier edit', () => {
    const original = applyOp(doc(), { type: 'addItem', trackId: 'video', item: newClip() }).doc;
    const editA = applyOp(original, { type: 'setProps', itemId: clipId, patch: { note: 'Edit A' } });
    const editB = applyOp(editA.doc, { type: 'setProps', itemId: 'clip_footage002', patch: { note: 'Edit B' } });
    const revertedA = applyOps(editB.doc, editA.inverse).doc;
    expect(item(revertedA).note).toBeUndefined();
    expect(item(revertedA, 'clip_footage002').note).toBe('Edit B');
  });
  it('track metadata undo never overwrites later item edits on that track', () => {
    const editA = applyOp(doc(), { type: 'setTrack', trackId: 'video', muted: true });
    const editB = applyOp(editA.doc, { type: 'setProps', itemId: clipId, patch: { note: 'Later item edit' } });
    const revertedA = applyOps(editB.doc, editA.inverse).doc;
    expect(revertedA.tracks[3]?.muted).toBe(false);
    expect(item(revertedA).note).toBe('Later item edit');
  });
  it('restores off-grid imported timing verbatim', () => {
    const original = doc(); const source = item(original);
    source.start = 0.013; source.duration = 9.987;
    if (source.type === 'clip') source.out = 9.987;
    const result = applyOp(original, { type: 'moveItem', itemId: clipId, start: 1 });
    expect(applyOps(result.doc, result.inverse).doc).toEqual(original);
  });
  it('history records validate but are never public agent operations', () => {
    const inverse = applyOp(doc(), { type: 'deleteItem', itemId: clipId }).inverse[0];
    expect(historyOpSchema.safeParse(inverse).success).toBe(true);
    expect(opSchema.safeParse(inverse).success).toBe(false);
  });
  it('provides duration, frame and active-item helpers', () => {
    expect(timelineDuration(doc())).toBe(10); expect(frameOf(1.5, 30)).toBe(45);
    expect(itemsAt(doc(), 0).map((entry) => entry.id)).toEqual([compositionId, clipId]);
    expect(itemsAt(doc(), 10)).toEqual([]);
  });
  it.each([
    [{ type: 'addItem', trackId: 'missing', item: newClip() }, 'not_found'],
    [{ type: 'moveItem', itemId: clipId, start: -1 }, 'invalid'],
    [{ type: 'trimItem', itemId: 'clip_missing000', edge: 'end', time: 2 }, 'not_found'],
    [{ type: 'splitItem', itemId: clipId, at: 0 }, 'out_of_bounds'],
    [{ type: 'deleteItem', itemId: 'clip_missing000' }, 'not_found'],
    [{ type: 'rippleDelete', itemId: 'clip_missing000' }, 'not_found'],
    [{ type: 'insertGap', trackId: 'video', at: 2, duration: 1 }, 'out_of_bounds'],
    [{ type: 'reorderItem', itemId: clipId, index: 3 }, 'out_of_bounds'],
    [{ type: 'setProps', itemId: clipId, patch: { id: 'clip_changed000' } }, 'invalid'],
    [{ type: 'setProps', itemId: clipId, patch: { duration: -1 } }, 'invalid'],
    [{ type: 'setTrack', trackId: 'missing', muted: true }, 'not_found'],
    [{ type: 'setFormat', format: { fps: 17 } }, 'invalid'],
    [{ type: 'addMarker', marker: { ...marker, time: -1 } }, 'invalid'],
    [{ type: 'updateMarker', markerId: 'missing', patch: { time: 1 } }, 'not_found'],
    [{ type: 'deleteMarker', markerId: 'missing' }, 'not_found'],
  ] as const)('rejects %j with %s', (op, code) => {
    expectError(() => applyOp(doc(), op as unknown as Op), code);
  });
});

describe('inverse property', () => {
  it('restores random valid docs exactly for 250 generated edits', () => {
    fc.assert(fc.property(
      fc.integer({ min: 2, max: 600 }), fc.integer({ min: 0, max: 600 }), fc.integer({ min: 0, max: 8 }),
      (frames, position, choice) => {
        const original = doc(); const clip = item(original); clip.duration = frames / 30;
        if (clip.type === 'clip') clip.out = frames / 30;
        const ops: Op[] = [
          { type: 'moveItem', itemId: clipId, start: position / 30 },
          { type: 'trimItem', itemId: clipId, edge: 'end', time: (frames + 3) / 30 },
          { type: 'deleteItem', itemId: clipId },
          { type: 'setProps', itemId: clipId, patch: { note: `Take ${position}` } },
          { type: 'setTrack', trackId: 'video', muted: position % 2 === 0 },
          { type: 'insertGap', trackId: 'video', at: 0, duration: (position + 1) / 30 },
          { type: 'splitItem', itemId: clipId, at: Math.floor(frames / 2) / 30 },
          { type: 'addMarker', marker: { ...marker, time: position / 30 } },
          { type: 'reorderItem', itemId: clipId, index: 0 },
        ];
        const op = ops[choice]; if (!op) throw new Error('Missing generated op');
        const result = applyOp(original, op);
        expect(applyOps(result.doc, result.inverse).doc).toEqual(original);
      },
    ), { numRuns: 250 });
  });
});
