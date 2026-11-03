import { isDeepStrictEqual } from 'node:util';
import { IpcFailure } from '@shared/ipc/errors';
import type { TimelineDoc, TimelineItem } from '@shared/schema/timeline';
import type { HistoryOp } from '@shared/timeline/types';
import type { TimelineChange, TimelineService } from '../timeline/service';

interface Location { item: TimelineItem; trackId: string; index: number }
interface Change { before?: Location; after?: Location; paths: string[] }
const locations = (doc: TimelineDoc): Map<string, Location> => new Map(doc.tracks.flatMap((track) => track.items.map((item, index) => [item.id, { item, index, trackId: track.id }] as const)));
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function diff(a: unknown, b: unknown, prefix = ''): string[] {
  if (isDeepStrictEqual(a, b)) return [];
  if (object(a) && object(b)) return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((key) => key === 'userEdited' ? [] : diff(a[key], b[key], prefix ? `${prefix}.${key}` : key));
  return [prefix];
}
function get(value: unknown, path: string): unknown { return path.split('.').reduce<unknown>((current, part) => object(current) ? current[part] : undefined, value); }
function put(value: Record<string, unknown>, path: string, replacement: unknown): void {
  const parts = path.split('.'); const last = parts.pop()!; let target = value;
  for (const part of parts) { if (!object(target[part])) target[part] = {}; target = target[part] as Record<string, unknown>; }
  if (replacement === undefined) delete target[last]; else target[last] = structuredClone(replacement);
}
export class ChangeReview {
  private readonly requests = new Map<string, Map<string, Change>>();
  record(change: TimelineChange): { itemId: string; paths: string[]; before: TimelineItem | null; after: TimelineItem | null }[] {
    if (!change.requestId || !change.actor.startsWith('agent:')) return [];
    const before = locations(change.before); const after = locations(change.doc); const pending = this.requests.get(change.requestId) ?? new Map<string, Change>();
    const emitted = [];
    for (const itemId of change.itemIds) {
      const first = pending.get(itemId); const original = first ? first.before : before.get(itemId); const latest = after.get(itemId);
      const paths = original && latest ? [...diff(original.item, latest.item), ...(original.trackId !== latest.trackId || original.index !== latest.index ? ['$location'] : [])] : ['$entity'];
      pending.set(itemId, { before: original, after: latest, paths }); emitted.push({ itemId, paths, before: original?.item ?? null, after: latest?.item ?? null });
    }
    this.requests.set(change.requestId, pending); return emitted;
  }
  keep(requestId: string, itemIds?: string[]): void { const pending = this.requests.get(requestId); if (!pending) return; if (!itemIds) this.requests.delete(requestId); else { itemIds.forEach((id) => pending.delete(id)); if (!pending.size) this.requests.delete(requestId); } }
  async revert(timeline: TimelineService, requestId: string, itemIds?: string[], resolution?: 'keepCurrent' | 'restoreOriginal') {
    const pending = this.requests.get(requestId); if (!pending) return timeline.state();
    const state = timeline.state(); const current = locations(state.doc); const ops: HistoryOp[] = []; const conflicts: Record<string, unknown>[] = [];
    for (const [id, change] of pending) {
      if (itemIds && !itemIds.includes(id)) continue;
      const now = current.get(id);
      const entity = change.paths.includes('$entity');
      if (entity) {
        if (!isDeepStrictEqual(now, change.after)) {
          if (!resolution) conflicts.push({ itemId: id, path: '$entity', original: change.before?.item ?? null, agent: change.after?.item ?? null, current: now?.item ?? null });
          if (resolution !== 'restoreOriginal') continue;
        }
        const location = change.before ?? change.after!; ops.push({ type: 'restoreItem', itemId: id, trackId: location.trackId, index: location.index, item: change.before?.item ?? null }); continue;
      }
      if (!now) { if (!resolution) conflicts.push({ itemId: id, path: '$entity', original: change.before?.item, agent: change.after?.item, current: null }); if (resolution === 'restoreOriginal') ops.push({ type: 'restoreItem', itemId: id, ...change.before!, item: change.before!.item }); continue; }
      const restored = structuredClone(now.item) as unknown as Record<string, unknown>; let touched = false; let trackId = now.trackId; let index = now.index;
      for (const property of change.paths) {
        const original = property === '$location' ? [change.before!.trackId, change.before!.index] : get(change.before!.item, property);
        const agent = property === '$location' ? [change.after!.trackId, change.after!.index] : get(change.after!.item, property);
        const value = property === '$location' ? [now.trackId, now.index] : get(now.item, property);
        if (!isDeepStrictEqual(value, agent)) {
          if (!resolution) conflicts.push({ itemId: id, path: property, original, agent, current: value });
          if (resolution !== 'restoreOriginal') continue;
        }
        if (property === '$location') { trackId = change.before!.trackId; index = change.before!.index; } else put(restored, property, original); touched = true;
      }
      if (touched) ops.push({ type: 'restoreItem', itemId: id, trackId, index, item: restored as unknown as TimelineItem });
    }
    if (conflicts.length) throw new IpcFailure({ code: 'conflict', message: 'Some properties changed after the assistant edit. Choose which values to keep.', details: { conflicts } });
    const result = ops.length ? await timeline.applyReview(ops, state.revision) : state; this.keep(requestId, itemIds); return result;
  }
  clear(): void { this.requests.clear(); }
}
