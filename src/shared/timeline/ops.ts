import { nanoid } from 'nanoid';
import { NO_OVERLAP_TRACKS, itemSchema, timelineDocSchema, type TimelineDoc, type TimelineItem, type Track } from '../schema/timeline';
import { historyOpSchema, opSchema, trackMetadataSchema, type HistoryOp } from './types';

export { historyOpSchema, opSchema, type Op, type HistoryOp } from './types';
export type TimelineErrorCode = 'not_found' | 'out_of_bounds' | 'overlap' | 'invalid';
export class TimelineError extends Error {
  constructor(public readonly code: TimelineErrorCode, message: string) { super(message); this.name = 'TimelineError'; }
}
export interface OpContext { sourceDurations?: Readonly<Record<string, number>> }
export interface OpResult {
  doc: TimelineDoc;
  inverse: HistoryOp[];
  changed: { itemIds: string[]; paths: string[] };
}

export const frameOf = (time: number, fps: number): number => Math.round(time * fps);
const quantize = (time: number, fps: number): number => frameOf(time, fps) / fps;
const fail = (code: TimelineErrorCode, message: string): never => { throw new TimelineError(code, message); };
const endOf = (item: TimelineItem): number => item.start + item.duration;
export const timelineDuration = (doc: TimelineDoc): number => Math.max(0, ...doc.tracks.flatMap((track) => track.items.map(endOf)));
export const itemsAt = (doc: TimelineDoc, time: number): TimelineItem[] => doc.tracks.flatMap((track) => track.items.filter((item) => item.start <= time && time < endOf(item)));

function trackById(doc: TimelineDoc, id: string): Track {
  return doc.tracks.find((track) => track.id === id) ?? fail('not_found', 'Track not found');
}
function locate(doc: TimelineDoc, id: string): { track: Track; item: TimelineItem; index: number } {
  for (const track of doc.tracks) {
    const index = track.items.findIndex((item) => item.id === id);
    const item = track.items[index];
    if (item) return { track, item, index };
  }
  return fail('not_found', 'Item not found');
}
function media(item: TimelineItem): item is Extract<TimelineItem, { type: 'clip' | 'audio' }> { return item.type === 'clip' || item.type === 'audio'; }
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function merge(target: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('invalid', 'Unsafe property name');
    if (value === null) delete result[key];
    else result[key] = record(value) ? merge(record(result[key]) ? result[key] : {}, value) : value;
  }
  return result;
}
function patchPaths(patch: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(patch).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return record(value) && Object.keys(value).length ? patchPaths(value, path) : [path];
  });
}
function validate(doc: TimelineDoc, ctx: OpContext): void {
  const parsed = timelineDocSchema.safeParse(doc);
  if (!parsed.success) fail('invalid', parsed.error.issues.map((issue) => issue.message).join('; '));
  for (const track of doc.tracks) {
    const sorted = [...track.items].sort((a, b) => a.start - b.start);
    if ((NO_OVERLAP_TRACKS as readonly string[]).includes(track.kind)) {
      for (let i = 1; i < sorted.length; i++) {
        const previous = sorted[i - 1]; const current = sorted[i];
        if (previous && current && current.start < endOf(previous) - 1e-8) fail('overlap', `Items overlap on ${track.kind}`);
      }
    }
    for (const item of track.items) {
      if (media(item)) {
        const sourceDuration = ctx.sourceDurations?.[item.src];
        if (sourceDuration !== undefined && (!Number.isFinite(sourceDuration) || item.out > sourceDuration + 1e-8)) fail('out_of_bounds', 'Item exceeds source duration');
      }
    }
  }
}

function itemSnapshot(doc: TimelineDoc, itemId: string, fallbackTrackId: string, fallbackIndex: number): HistoryOp {
  for (const track of doc.tracks) {
    const index = track.items.findIndex((item) => item.id === itemId);
    const item = track.items[index];
    if (item) return { type: 'restoreItem', itemId, trackId: track.id, index, item: structuredClone(item) };
  }
  return { type: 'restoreItem', itemId, trackId: fallbackTrackId, index: fallbackIndex, item: null };
}
function markerSnapshot(doc: TimelineDoc, markerId: string): HistoryOp {
  const index = doc.markers.findIndex((marker) => marker.id === markerId);
  return { type: 'restoreMarker', markerId, index: Math.max(0, index), marker: structuredClone(doc.markers[index] ?? null) };
}

export function applyOp(original: TimelineDoc, input: HistoryOp, ctx: OpContext = {}): OpResult {
  const history = historyOpSchema.safeParse(input);
  if (!history.success) return fail('invalid', 'Invalid timeline or history operation');
  const record = history.data;
  if (record.type === 'restoreTimeline') {
    return {
      doc: structuredClone(record.doc), inverse: [{ type: 'restoreTimeline', doc: structuredClone(original) }],
      changed: { itemIds: [...new Set([...original.tracks, ...record.doc.tracks].flatMap((track) => track.items.map((item) => item.id)))], paths: ['*'] },
    };
  }
  if (record.type === 'restoreItem' || record.type === 'restoreTrack' || record.type === 'restoreFormat' || record.type === 'restoreMarker') {
    const doc = structuredClone(original);
    let inverse: HistoryOp;
    let itemIds: string[] = []; let paths: string[];
    switch (record.type) {
      case 'restoreItem': {
        inverse = itemSnapshot(original, record.itemId, record.trackId, record.index);
        const target = trackById(doc, record.trackId);
        for (const track of doc.tracks) track.items = track.items.filter((item) => item.id !== record.itemId);
        if (record.item) target.items.splice(Math.min(record.index, target.items.length), 0, structuredClone(record.item));
        itemIds = [record.itemId]; paths = [`items.${record.itemId}.*`]; break;
      }
      case 'restoreTrack': {
        const track = trackById(doc, record.track.id);
        inverse = { type: 'restoreTrack', track: trackMetadataSchema.strip().parse(track) };
        Object.assign(track, structuredClone(record.track)); paths = [`tracks.${track.id}`]; break;
      }
      case 'restoreFormat':
        inverse = { type: 'restoreFormat', format: structuredClone(doc.format) };
        doc.format = structuredClone(record.format); paths = ['format']; break;
      case 'restoreMarker': {
        inverse = markerSnapshot(original, record.markerId);
        doc.markers = doc.markers.filter((marker) => marker.id !== record.markerId);
        if (record.marker) doc.markers.splice(Math.min(record.index, doc.markers.length), 0, structuredClone(record.marker));
        paths = [`markers.${record.markerId}`]; break;
      }
    }
    // History restores exact pre-edit values. No quantization or overlap revalidation.
    return { doc, inverse: [inverse], changed: { itemIds, paths } };
  }
  validate(original, ctx);
  const parsed = opSchema.safeParse(record);
  if (!parsed.success) return fail('invalid', 'Invalid timeline operation');
  const op = parsed.data;
  const doc = structuredClone(original);
  const fps = doc.format.fps;
  const touched = new Set<string>(); const paths = new Set<string>();
  const touch = (item: TimelineItem, ...fields: string[]): void => { touched.add(item.id); for (const field of fields) paths.add(`items.${item.id}.${field}`); };
  const quantizeItem = (item: TimelineItem): void => {
    item.start = quantize(item.start, doc.format.fps);
    item.duration = quantize(item.duration, doc.format.fps);
    if (item.duration <= 0 || item.start < 0) fail('out_of_bounds', 'Item must occupy at least one frame');
  };
  switch (op.type) {
    case 'addItem': {
      const track = trackById(doc, op.trackId);
      if (doc.tracks.some((track) => track.items.some((item) => item.id === op.item.id))) fail('invalid', 'Duplicate item id');
      const item = structuredClone(op.item); quantizeItem(item);
      const index = op.index ?? track.items.length;
      if (index > track.items.length) fail('out_of_bounds', 'Item index out of bounds');
      track.items.splice(index, 0, item); touch(item, '*'); break;
    }
    case 'moveItem': {
      const found = locate(doc, op.itemId);
      if (op.trackId && op.trackId !== found.track.id) {
        const target = trackById(doc, op.trackId);
        found.track.items.splice(found.index, 1); target.items.push(found.item);
        paths.add(`items.${found.item.id}.trackId`);
      }
      found.item.start = op.start; quantizeItem(found.item); touch(found.item, 'start'); break;
    }
    case 'trimItem': {
      const { item } = locate(doc, op.itemId);
      const oldStart = item.start; const oldEnd = endOf(item); const rate = item.type === 'clip' ? item.speed : 1;
      let time = quantize(op.time, fps);
      if (op.edge === 'start') {
        const earliest = media(item) ? Math.max(0, item.start - item.in / rate) : 0;
        time = Math.max(Math.ceil((earliest - 1e-8) * fps) / fps, Math.min(time, oldEnd - 1 / fps));
        if (media(item)) item.in = Math.max(0, item.in + (time - item.start) * rate);
        item.duration = oldEnd - time; item.start = time;
      } else {
        const sourceDuration = media(item) ? ctx.sourceDurations?.[item.src] : undefined;
        const latest = sourceDuration !== undefined && media(item) ? item.start + (sourceDuration - item.in) / rate : Infinity;
        time = Math.min(Math.floor((latest + 1e-8) * fps) / fps, Math.max(time, item.start + 1 / fps));
        if (time <= item.start) fail('out_of_bounds', 'Source has no remaining frame');
        if (media(item)) item.out = item.in + (time - item.start) * rate;
        item.duration = time - item.start;
      }
      quantizeItem(item);
      if (item.type === 'caption') {
        const offset = item.start - oldStart;
        item.words = item.words.map((word) => ({ ...word, start: Math.max(0, word.start - offset), end: Math.min(item.duration, word.end - offset) }))
          .filter((word) => word.end > word.start);
        if (!item.words.some((word) => word.id === item.highlight)) item.highlight = null;
      }
      touch(item, 'start', 'duration', ...(media(item) ? ['in', 'out'] : []), ...(item.type === 'caption' ? ['words', 'highlight'] : [])); break;
    }
    case 'splitItem': {
      const { track, item, index } = locate(doc, op.itemId);
      const at = quantize(op.at, fps); const leftDuration = at - item.start;
      if (leftDuration < 1 / fps - 1e-8 || endOf(item) - at < 1 / fps - 1e-8) fail('out_of_bounds', 'Split must be inside the item');
      const right = structuredClone(item); right.id = `${item.type}_${nanoid(10)}`;
      right.start = at; right.duration = endOf(item) - at; item.duration = leftDuration;
      if (media(item) && media(right)) {
        const cut = item.in + leftDuration * (item.type === 'clip' ? item.speed : 1);
        item.out = cut; right.in = cut;
      }
      if (item.type === 'caption' && right.type === 'caption') {
        const words = item.words;
        item.words = words.filter((word) => word.start < leftDuration).map((word) => ({ ...word, end: Math.min(word.end, leftDuration) }));
        right.words = words.filter((word) => word.end > leftDuration).map((word) => ({ ...word, start: Math.max(0, word.start - leftDuration), end: word.end - leftDuration }));
      }
      quantizeItem(item); quantizeItem(right); track.items.splice(index + 1, 0, right);
      touch(item, '*'); touch(right, '*'); break;
    }
    case 'deleteItem': case 'rippleDelete': {
      const { track, item, index } = locate(doc, op.itemId); track.items.splice(index, 1); touch(item, '*');
      if (op.type === 'rippleDelete') for (const next of track.items) {
        if (next.start >= endOf(item) - 1e-8) { next.start -= item.duration; quantizeItem(next); touch(next, 'start'); }
      }
      break;
    }
    case 'insertGap': {
      const track = trackById(doc, op.trackId); const at = quantize(op.at, fps); const duration = quantize(op.duration, fps);
      if (duration <= 0) fail('out_of_bounds', 'Gap must occupy at least one frame');
      if (track.items.some((item) => item.start < at - 1e-8 && endOf(item) > at + 1e-8)) fail('out_of_bounds', 'Split an item before inserting a gap inside it');
      for (const item of track.items) if (item.start >= at - 1e-8) { item.start += duration; quantizeItem(item); touch(item, 'start'); }
      break;
    }
    case 'reorderItem': {
      const { track, item, index } = locate(doc, op.itemId);
      if (op.index >= track.items.length) fail('out_of_bounds', 'Item index out of bounds');
      track.items.splice(index, 1); track.items.splice(op.index, 0, item); touch(item, 'index'); break;
    }
    case 'setProps': {
      const { track, item, index } = locate(doc, op.itemId);
      if (['id', 'type', 'createdBy', 'userEdited'].some((key) => Object.hasOwn(op.patch, key))) fail('invalid', 'Identity and edit authority cannot be patched');
      const patched = merge(item as unknown as Record<string, unknown>, op.patch);
      const parsedItem = itemSchema.safeParse(patched);
      if (!parsedItem.success) return fail('invalid', 'Invalid item property patch');
      track.items[index] = parsedItem.data;
      const replacement = track.items[index];
      if (replacement) { quantizeItem(replacement); touch(replacement, ...patchPaths(op.patch)); }
      break;
    }
    case 'setTrack': {
      const track = trackById(doc, op.trackId);
      for (const key of ['muted', 'solo', 'name'] as const) {
        const value = op[key];
        if (value !== undefined) { Object.assign(track, { [key]: value }); paths.add(`tracks.${track.id}.${key}`); }
      }
      break;
    }
    case 'setFormat': {
      Object.assign(doc.format, op.format); paths.add('format');
      for (const track of doc.tracks) for (const item of track.items) { quantizeItem(item); touch(item, 'start', 'duration'); }
      break;
    }
    case 'addMarker': {
      if (doc.markers.some((marker) => marker.id === op.marker.id)) fail('invalid', 'Duplicate marker id');
      doc.markers.push(structuredClone(op.marker)); paths.add(`markers.${op.marker.id}`); break;
    }
    case 'updateMarker': {
      const marker = doc.markers.find((marker) => marker.id === op.markerId) ?? fail('not_found', 'Marker not found');
      Object.assign(marker, op.patch); paths.add(`markers.${marker.id}`); break;
    }
    case 'deleteMarker': {
      const index = doc.markers.findIndex((marker) => marker.id === op.markerId);
      if (index < 0) fail('not_found', 'Marker not found');
      doc.markers.splice(index, 1); paths.add(`markers.${op.markerId}`); break;
    }
  }
  validate(doc, ctx);
  const inverse: HistoryOp[] = [];
  for (const id of touched) {
    const current = locate(doc.tracks.some((track) => track.items.some((item) => item.id === id)) ? doc : original, id);
    inverse.push(itemSnapshot(original, id, current.track.id, current.index));
  }
  if (op.type === 'setTrack') inverse.push({ type: 'restoreTrack', track: trackMetadataSchema.strip().parse(trackById(original, op.trackId)) });
  if (op.type === 'setFormat') inverse.push({ type: 'restoreFormat', format: structuredClone(original.format) });
  if (op.type === 'addMarker') inverse.push(markerSnapshot(original, op.marker.id));
  if (op.type === 'updateMarker' || op.type === 'deleteMarker') inverse.push(markerSnapshot(original, op.markerId));
  return { doc, inverse, changed: { itemIds: [...touched], paths: [...paths] } };
}

export function applyOps(original: TimelineDoc, ops: readonly HistoryOp[], ctx: OpContext = {}): OpResult {
  let doc = original; const inverse: HistoryOp[] = []; const itemIds = new Set<string>(); const paths = new Set<string>();
  for (const op of ops) {
    const result = applyOp(doc, op, ctx); doc = result.doc; inverse.unshift(...result.inverse);
    result.changed.itemIds.forEach((id) => itemIds.add(id)); result.changed.paths.forEach((path) => paths.add(path));
  }
  return { doc, inverse, changed: { itemIds: [...itemIds], paths: [...paths] } };
}
