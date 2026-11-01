export interface Timed { start: number; duration: number }
export interface IntervalIndex<T extends Timed> { items: T[]; maxEnds: number[] }

export function indexIntervals<T extends Timed>(items: readonly T[]): IntervalIndex<T> {
  const sorted = [...items].sort((a, b) => a.start - b.start);
  let end = 0;
  return { items: sorted, maxEnds: sorted.map((item) => { end = Math.max(end, item.start + item.duration); return end; }) };
}

export function visibleItems<T extends Timed>(index: IntervalIndex<T>, start: number, end: number): T[] {
  let low = 0; let high = index.items.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((index.maxEnds[middle] ?? 0) < start) low = middle + 1;
    else high = middle;
  }
  const result: T[] = [];
  for (let i = low; i < index.items.length; i++) {
    const item = index.items[i];
    if (!item || item.start > end) break;
    if (item.start + item.duration >= start) result.push(item);
  }
  return result;
}

export interface SnapTarget { time: number; kind: 'playhead' | 'edge' | 'marker' | 'zero' }
const priority = { playhead: 0, edge: 1, marker: 2, zero: 3 };
export function snapTime(time: number, targets: readonly SnapTarget[], pxPerSecond: number, bypass = false): { time: number; target: SnapTarget | null } {
  if (bypass || pxPerSecond <= 0) return { time, target: null };
  let chosen: SnapTarget | null = null;
  let distance = 8 / pxPerSecond;
  for (const target of targets) {
    const delta = Math.abs(target.time - time);
    if (delta < distance || delta === distance && (!chosen || priority[target.kind] < priority[chosen.kind])) {
      chosen = target; distance = delta;
    }
  }
  return { time: chosen?.time ?? time, target: chosen };
}

export function rulerInterval(pxPerSecond: number, fps: number): number {
  return [1 / fps, 0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600, 1800, 3600].find((interval) => interval * pxPerSecond >= 64) ?? 3600;
}
