import { nanoid } from 'nanoid';
import type { TimelineDoc } from '@shared/schema/timeline';
import { paste, selectedItems, type CopiedItem } from './commands';
import { useNavigation } from '../../state/navigation';

let contents: CopiedItem[] = [];
export function copy(doc: TimelineDoc, ids: readonly string[]) { contents = structuredClone(selectedItems(doc, ids)); return contents.map((e) => e.item.id); }
export function pasteClipboard(doc: TimelineDoc, at: number) { return paste(doc, contents, at, contents.map(({ item }) => `${item.type}_${nanoid(10)}`)); }
export function duplicate(doc: TimelineDoc, ids: readonly string[]) {
  const selected = selectedItems(doc, ids);
  const items = selected.filter((e) => !doc.tracks.find((t) => t.id === e.trackId)?.locked);
  const result = paste(doc, items, Math.max(0, ...items.map(({ item }) => item.start + item.duration)), items.map(({ item }) => `${item.type}_${nanoid(10)}`));
  const count = selected.length - items.length;
  return { ...result, ...(count ? { note: `${count} locked clip${count === 1 ? " wasn't" : "s weren't"} changed.` } : {}) };
}
export function clearClipboard() { contents = []; }
useNavigation.subscribe((next, previous) => { if (next.project?.project.id !== previous.project?.project.id) clearClipboard(); });
