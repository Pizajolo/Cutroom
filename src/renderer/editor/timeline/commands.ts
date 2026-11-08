import { NO_OVERLAP_TRACKS, type TimelineDoc, type TimelineItem, type Track } from '@shared/schema/timeline';
import type { Op } from '@shared/timeline/types';

export interface Command { ops: Op[]; note?: string }
export interface CopiedItem { trackId: string; item: TimelineItem }
export const endOf = (item: TimelineItem) => item.start + item.duration;
export const itemLabel = (item: TimelineItem): string => item.type === 'text' ? item.text : item.type === 'caption' ? item.words.map((w) => w.text).join(' ') : item.type === 'composition' ? item.path : item.src.split('/').pop() ?? item.src;
export const selectedItems = (doc: TimelineDoc, ids: readonly string[]) => doc.tracks.flatMap((track) => track.items.filter((i) => ids.includes(i.id)).map((item) => ({ trackId: track.id, item })));
export const accepts = (track: Track, item: TimelineItem) => item.type === 'audio' ? ['voiceover', 'music', 'sfx'].includes(track.kind) : item.type === 'clip' ? ['video', 'broll'].includes(track.kind) : item.type === 'text' ? track.kind === 'text' : item.type === 'caption' ? track.kind === 'captions' : track.kind === 'overlay';
const frame = (time: number, fps: number) => Math.round(time * fps) / fps;
const lockedNote = (count: number) => count ? `${count} locked clip${count === 1 ? " wasn't" : "s weren't"} changed.` : undefined;
function unlocked(doc: TimelineDoc, ids: readonly string[]) {
  const selected = selectedItems(doc, ids);
  const items = selected.filter((entry) => !doc.tracks.find((t) => t.id === entry.trackId)?.locked);
  return { items, note: lockedNote(selected.length - items.length) };
}
function validatePlacement(doc: TimelineDoc, entries: CopiedItem[], removed: readonly string[] = []) {
  for (const { trackId, item } of entries) {
    const track = doc.tracks.find((t) => t.id === trackId);
    if (!track) throw new Error('The destination track is unavailable.');
    if (track.locked) throw new Error(`${track.name} is locked.`);
    if (!accepts(track, item)) throw new Error(['voiceover', 'music', 'sfx'].includes(track.kind) ? 'This track accepts audio.' : 'This track accepts visual media.');
    if (item.start < 0) throw new Error('Clips cannot start before zero.');
    if ((NO_OVERLAP_TRACKS as readonly string[]).includes(track.kind)) {
      const others = [...track.items.filter((i) => !removed.includes(i.id)), ...entries.filter((e) => e.trackId === trackId && e.item.id !== item.id).map((e) => e.item)];
      if (others.some((other) => item.start < endOf(other) - 1e-8 && endOf(item) > other.start + 1e-8)) throw new Error(`Overlaps ${track.kind === 'video' ? 'Video' : track.name}`);
    }
  }
}
export function moveSelection(doc: TimelineDoc, ids: readonly string[], delta: number, trackDelta = 0): Command {
  const { items, note } = unlocked(doc, ids);
  if (!items.length) return { ops: [], note };
  const shift = Math.max(frame(delta, doc.format.fps), -Math.min(...items.map((e) => e.item.start)));
  const entries = items.map(({ trackId, item }) => {
    const target = doc.tracks[doc.tracks.findIndex((t) => t.id === trackId) + trackDelta];
    if (!target) throw new Error('No compatible track here.');
    return { trackId: target.id, item: { ...item, start: frame(item.start + shift, doc.format.fps) } };
  });
  validatePlacement(doc, entries, items.map((e) => e.item.id));
  return { ops: [{ type: 'moveItems', moves: entries.map(({ trackId, item }) => ({ itemId: item.id, trackId, start: item.start })) }], note };
}
export function nudge(doc: TimelineDoc, ids: readonly string[], frames: number): Command { return moveSelection(doc, ids, frames / doc.format.fps); }
export function paste(doc: TimelineDoc, copied: readonly CopiedItem[], at: number, ids: readonly string[]): Command {
  if (!copied.length) return { ops: [] };
  const first = Math.min(...copied.map((e) => e.item.start));
  const entries = copied.map((entry, index) => ({ trackId: entry.trackId, item: { ...structuredClone(entry.item), id: ids[index]!, start: frame(at + entry.item.start - first, doc.format.fps), createdBy: 'user' as const, userEdited: [] } }));
  validatePlacement(doc, entries);
  return { ops: entries.map(({ trackId, item }) => ({ type: 'addItem', trackId, item })) };
}
export function split(doc: TimelineDoc, ids: readonly string[], at: number, all = false, focusedTrack?: string | null): Command {
  const time = frame(at, doc.format.fps);
  const targets = all ? doc.tracks.flatMap((t) => t.items.map((i) => i.id)) : ids.length ? ids : doc.tracks.filter((t) => t.id === focusedTrack || !focusedTrack && t.kind === 'video').flatMap((t) => t.items.map((i) => i.id));
  const { items, note } = unlocked(doc, targets);
  return { ops: items.filter(({ item }) => time - item.start >= 1 / doc.format.fps - 1e-8 && endOf(item) - time >= 1 / doc.format.fps - 1e-8).map(({ item }) => ({ type: 'splitItem', itemId: item.id, at: time })), note };
}
export function deleteSelection(doc: TimelineDoc, ids: readonly string[], ripple: boolean): Command {
  const { items, note } = unlocked(doc, ids);
  return { ops: items.sort((a, b) => b.item.start - a.item.start).map(({ item }) => ({ type: ripple ? 'rippleDelete' : 'deleteItem', itemId: item.id })), note };
}
export function trimSelection(doc: TimelineDoc, ids: readonly string[], at: number, edge: 'start' | 'end', ripple: boolean): Command {
  const { items, note } = unlocked(doc, ids);
  const time = frame(at, doc.format.fps);
  if (items.some(({ item }) => time <= item.start || time >= endOf(item))) return { ops: [], note: 'Place the playhead inside the selected clips to trim.' };
  return { ops: items.sort((a, b) => b.item.start - a.item.start).map(({ item }) => ({ type: ripple ? 'rippleTrim' : 'trimItem', itemId: item.id, edge, time })), note };
}
export function selectForward(doc: TimelineDoc, ids: readonly string[], at: number) {
  const tracks = new Set(selectedItems(doc, ids).map((e) => e.trackId));
  return doc.tracks.filter((t) => !tracks.size || tracks.has(t.id)).flatMap((t) => t.items.filter((i) => i.start >= at).map((i) => ({ itemId: i.id })));
}
