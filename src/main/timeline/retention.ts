import type { SnapshotInfo } from '@shared/schema/editor';

export function snapshotsToPrune(snapshots: readonly SnapshotInfo[], policy: { retainDays: number; maxBytes: number }, now = Date.now()): string[] {
  const sorted = [...snapshots].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); const removed: string[] = []; let bytes = 0;
  for (const [index, snapshot] of sorted.entries()) {
    const expired = Date.parse(snapshot.createdAt) < now - policy.retainDays * 86_400_000;
    if (index > 0 && (expired || bytes + snapshot.bytes > policy.maxBytes)) removed.push(snapshot.id); else bytes += snapshot.bytes;
  }
  return removed;
}
