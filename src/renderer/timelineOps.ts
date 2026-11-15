// Pure edits on a timeline. The Pro editor and its keyboard shortcuts are built from these.
import { clipLength, clipStarts, playState, timelineLength } from '../shared/types';
import type { MediaFile, Timeline, TrackName, TrackState } from '../shared/types';

export type Track = TrackName;
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
  /** Seen and heard, after its own and its track's switches. */
  visible: boolean;
  audible: boolean;
  hidden: boolean;
  muted: boolean;
  /** 1 for anything that cannot change speed. */
  speed: number;
  volume: number;
  /** A still picture: no sound, no speed. */
  still: boolean;
}

const STILL = /\.(png|jpe?g|webp|gif|bmp|svg)$/i;

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
  const info = (track: Track, item: { src: string; hidden?: boolean; muted?: boolean; speed?: number; volume?: number }, volume: number) => ({
    ...playState(t, track, item),
    hidden: !!item.hidden,
    muted: !!item.muted,
    speed: item.speed || 1,
    volume: item.volume ?? volume,
    still: STILL.test(item.src),
  });
  return [
    ...t.clips.map((c, index) => ({ track: 'clips' as const, index, id: c.id, label: name(c), start: starts[index]!, length: clipLength(c), row: 0, ...info('clips', c, 1) })),
    ...stack(t.overlays.map((o, index) => ({ track: 'overlays' as const, index, id: o.id, label: name(o), start: o.at, length: o.duration, ...info('overlays', o, 0) }))),
    ...stack(t.audio.map((a, index) => ({ track: 'audio' as const, index, id: a.id, label: name(a), start: a.at, length: a.duration ?? Math.max(MIN, total - a.at), ...info('audio', a, 1) }))),
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
    item.in = Math.max(0, (item.in ?? 0) + move * ('speed' in item ? item.speed || 1 : 1));
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
    const rest = { ...item, id: newId(block.track[0]!), at: time, duration: block.length - offset, in: (item.in ?? 0) + offset * block.speed };
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

/** Change any of an item's own fields. */
export function patched(t: Timeline, { track, index }: Block, patch: Record<string, unknown>): Timeline {
  const next = structuredClone(t);
  Object.assign(next[track][index]!, patch);
  return next;
}

/** Change a whole track's switches (hide, mute, solo, lock). */
export function trackPatched(t: Timeline, track: Track, patch: TrackState): Timeline {
  const next = structuredClone(t);
  next.tracks = { ...next.tracks, [track]: { ...next.tracks?.[track], ...patch } };
  return next;
}

/**
 * Play an item at another speed. As in any editor the stretch of source stays the same, so the
 * item gets shorter or longer: on the main track everything after it moves up or back.
 */
export function withSpeed(t: Timeline, block: Block, speed: number): Timeline {
  const next = structuredClone(t);
  const item = next[block.track][block.index]!;
  if (block.track === 'overlays' && 'duration' in item && item.duration) item.duration = (item.duration * block.speed) / speed;
  (item as { speed?: number }).speed = speed === 1 ? undefined : speed;
  return next;
}

/** Trim the start or end of an item to the playhead. On the main track the gap closes (ripple). */
export function trimmedTo(t: Timeline, block: Block, edge: 'start' | 'end', time: number): Timeline {
  const end = block.start + block.length;
  if (time <= block.start + MIN / 2 || time >= end - MIN / 2) return t;
  return dragged(t, block, edge, edge === 'start' ? time - block.start : time - end);
}

/** Move a main-track clip's sound to the audio track, so it can be moved and trimmed on its own (J and L cuts). */
export function detached(t: Timeline, block: Block): Timeline {
  if (block.track !== 'clips' || block.speed !== 1 || block.still) return t;
  const next = structuredClone(t);
  const clip = next.clips[block.index]!;
  next.audio.push({ id: newId('a'), src: clip.src, at: block.start, in: clip.in, duration: block.length, volume: clip.volume ?? 1, ...(clip.muted ? { muted: true } : {}), label: `${block.label} · sound` });
  clip.muted = true;
  return next;
}

/** Every cut and item edge, in order: where ↑ and ↓ jump to. */
export function editPoints(all: Block[]): number[] {
  return [...new Set(all.flatMap((b) => [b.start, b.start + b.length]).map((n) => Math.round(n * 1000) / 1000))].sort((a, b) => a - b);
}
