// Pure edits on a timeline. The Pro editor and its keyboard shortcuts are built from these.
import { clipLength, clipStarts, timelineLength } from '../shared/types';
import type { MediaFile, Timeline } from '../shared/types';

export type Track = 'clips' | 'overlays' | 'audio';
export type Edge = 'start' | 'end' | 'body';

/** One block on screen, whatever track it is on. */
export interface Block {
  track: Track;
  index: number;
  id: string;
  label: string;
  start: number;
  length: number;
  row: number;
}

export const MIN = 0.1; // shortest item, seconds
const name = (item: { label?: string; src: string }): string => item.label ?? item.src.split('/').pop()!;
const newId = (prefix: string): string => `${prefix}${Date.now().toString(36)}`;

export function blocks(t: Timeline): Block[] {
  const starts = clipStarts(t);
  const total = timelineLength(t);
  // Overlapping layers or sounds stack into rows within their lane.
  const stack = (items: Omit<Block, 'row'>[]): Block[] => {
    const ends: number[] = [];
    return items.map((item) => {
      let row = ends.findIndex((end) => end <= item.start + 0.001);
      if (row < 0) row = ends.length;
      ends[row] = item.start + item.length;
      return { ...item, row };
    });
  };
  return [
    ...t.clips.map((c, index) => ({ track: 'clips' as const, index, id: c.id, label: name(c), start: starts[index]!, length: clipLength(c), row: 0 })),
    ...stack(t.overlays.map((o, index) => ({ track: 'overlays' as const, index, id: o.id, label: name(o), start: o.at, length: o.duration }))),
    ...stack(t.audio.map((a, index) => ({ track: 'audio' as const, index, id: a.id, label: name(a), start: a.at, length: a.duration ?? Math.max(MIN, total - a.at) }))),
  ];
}

/** Apply a drag of `dt` seconds to one block: trim an edge, or slide a layer or sound. */
export function dragged(t: Timeline, { track, index, length }: Block, edge: Edge, dt: number): Timeline {
  const next = structuredClone(t);
  if (track === 'clips') {
    const clip = next.clips[index]!;
    const source = dt * (clip.speed || 1);
    if (edge === 'start') clip.in = Math.max(0, Math.min(clip.in + source, clip.out - MIN));
    if (edge === 'end') clip.out = Math.max(clip.in + MIN, clip.out + source);
    return next;
  }
  const item = next[track][index]!;
  if (edge === 'end') {
    item.duration = Math.max(MIN, length + dt);
    return next;
  }
  const move = Math.max(-item.at, edge === 'start' ? Math.min(dt, length - MIN) : dt);
  item.at += move;
  if (edge === 'start') {
    item.duration = length - move;
    item.in = Math.max(0, (item.in ?? 0) + move);
  }
  return next;
}

/** Move a main-track clip to another position in the running order. */
export function reordered(t: Timeline, from: number, to: number): Timeline {
  const next = structuredClone(t);
  next.clips.splice(to, 0, ...next.clips.splice(from, 1));
  return next;
}

/** Cut a block in two at output time `time`. */
export function split(t: Timeline, block: Block, time: number): Timeline {
  const offset = time - block.start;
  if (offset < MIN || offset > block.length - MIN) return t;
  const next = structuredClone(t);
  if (block.track === 'clips') {
    const clip = next.clips[block.index]!;
    const at = clip.in + offset * (clip.speed || 1);
    next.clips.splice(block.index, 1, { ...clip, out: at }, { ...clip, id: newId('c'), in: at });
  } else {
    const list = next[block.track];
    const item = list[block.index]!;
    const rest = { ...item, id: newId(block.track[0]!), at: time, duration: block.length - offset, in: (item.in ?? 0) + offset };
    item.duration = offset;
    list.splice(block.index + 1, 0, rest as never);
  }
  return next;
}

export function duplicated(t: Timeline, block: Block): Timeline {
  const next = structuredClone(t);
  const list = next[block.track];
  const copy = { ...structuredClone(list[block.index]!), id: newId(block.track[0]!) };
  if ('at' in copy) copy.at = block.start + block.length;
  list.splice(block.index + 1, 0, copy as never);
  return next;
}

/** Put a media file on the timeline: footage on the main track or as a layer, sound on the audio track. */
export function added(t: Timeline, file: MediaFile, duration: number, time: number, asLayer: boolean): Timeline {
  const next = structuredClone(t);
  const length = duration || 3; // stills show for three seconds
  if (file.kind === 'audio') next.audio.push({ id: newId('a'), src: file.path, at: time, duration: length });
  else if (asLayer || file.kind === 'image') {
    const pip = file.kind === 'video' ? { x: 0.56, y: 0.05, w: 0.4 } : {};
    next.overlays.push({ id: newId('o'), src: file.path, at: time, duration: length, ...pip });
  } else next.clips.push({ id: newId('c'), src: file.path, in: 0, out: length });
  return next;
}

/** Snap a moving edge to the playhead or to the edges of other blocks, if one is within `reach` seconds. */
export function snap(value: number, all: Block[], moving: string, playhead: number, reach: number): number {
  const targets = [0, playhead, ...all.filter((b) => b.id !== moving).flatMap((b) => [b.start, b.start + b.length])];
  const best = targets.reduce((a, b) => (Math.abs(b - value) < Math.abs(a - value) ? b : a), Infinity);
  return Math.abs(best - value) <= reach ? best : value;
}
