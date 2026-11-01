import { describe, expect, it } from 'vitest';
import { indexIntervals, rulerInterval, snapTime, visibleItems } from '../../src/renderer/editor/timeline/geometry';
import { normalizePoint, pick, type PickLayer } from '../../src/renderer/editor/selection/pick';

it('culls long timelines while retaining overlapping items that start before the viewport', () => {
  const items = Array.from({ length: 10000 }, (_, i) => ({ id: String(i), start: i * 2, duration: 1 }));
  const indexed = indexIntervals(items);
  expect(visibleItems(indexed, 18000, 18001).map((item) => item.id)).toEqual(['9000']);
  const overlap = indexIntervals([{ start: 0, duration: 100 }, { start: 2, duration: 1 }, { start: 10, duration: 2 }]);
  expect(visibleItems(overlap, 11, 13)).toEqual([{ start: 0, duration: 100 }, { start: 10, duration: 2 }]);
});
it('snaps within eight screen pixels, prioritises playhead on ties, and supports Command bypass', () => {
  const targets = [{ time: 5, kind: 'edge' as const }, { time: 5, kind: 'playhead' as const }];
  expect(snapTime(4.9, targets, 64)).toEqual({ time: 5, target: targets[1] });
  expect(snapTime(4.9, targets, 64, true)).toEqual({ time: 4.9, target: null });
  expect(snapTime(4.8, targets, 64).target).toBeNull();
});
it('keeps ruler labels at least 64 pixels apart', () => {
  for (const zoom of [4, 16, 64, 256, 512]) expect(rulerInterval(zoom, 30) * zoom).toBeGreaterThanOrEqual(64);
});

describe('preview picking', () => {
  const bbox = { x: 0, y: 0, w: 1, h: 1 };
  const video: PickLayer = { itemId: 'video', name: 'Video', zIndex: 0, order: 0, bbox };
  it('picks the first composition hit in visual z-order, independent of input order', async () => {
    const title: PickLayer = { itemId: 'title', name: 'Title', zIndex: 4, order: 0, bbox, hitTest: async () => ({ cutId: 'title-1', name: 'Title', bbox }) };
    const broll: PickLayer = { ...video, itemId: 'broll', zIndex: 1 };
    expect(await pick([video, broll, title], { x: 0.5, y: 0.5 })).toMatchObject({ itemId: 'title', cutId: 'title-1' });
  });
  it('falls through a transparent composition to the video', async () => {
    expect(await pick([video, { ...video, zIndex: 5, hitTest: async () => null }], { x: 0.5, y: 0.5 })).toMatchObject({ itemId: 'video' });
    expect(await pick([video], { x: 2, y: 0.5 })).toBeNull();
  });
  it('normalises relative to the letterboxed canvas, not the surrounding panel', () => {
    const canvas = { left: 100, top: 200, width: 800, height: 450 };
    expect(normalizePoint({ x: 500, y: 425 }, canvas)).toEqual({ x: 0.5, y: 0.5 });
    expect(normalizePoint({ x: 50, y: 425 }, canvas)).toBeNull();
    expect(normalizePoint({ x: 0, y: 0 }, { ...canvas, width: 0 })).toBeNull();
  });
});
