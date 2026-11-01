import type { TimelineItem, Track } from '@shared/schema/timeline';

export type MediaItem = Extract<TimelineItem, { type: 'clip' | 'audio' }>;
export const activeAt = (item: TimelineItem, time: number): boolean => time >= item.start && time < item.start + item.duration;
export function sourceTime(item: MediaItem, time: number): number {
  return item.in + (time - item.start) * (item.type === 'clip' ? item.speed : 1);
}
export function isTrackAudible(track: Track, tracks: readonly Track[]): boolean {
  return !track.muted && (!tracks.some((entry) => entry.solo) || track.solo);
}
export function itemVolume(item: MediaItem, time: number): number {
  if (item.type === 'clip') return item.muted ? 0 : Math.min(1, item.volume);
  const elapsed = time - item.start;
  const remaining = item.start + item.duration - time;
  const fadeIn = item.fadeIn > 0 ? Math.max(0, Math.min(1, elapsed / item.fadeIn)) : 1;
  const fadeOut = item.fadeOut > 0 ? Math.max(0, Math.min(1, remaining / item.fadeOut)) : 1;
  return Math.min(1, 10 ** (item.gain / 20) * fadeIn * fadeOut);
}
