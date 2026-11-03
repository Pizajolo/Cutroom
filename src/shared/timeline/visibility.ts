import type { Track } from '../schema/timeline';

/** Mute wins over solo. Solo applies across all tracks, for picture and sound alike. */
export function isTrackEnabled(track: Track, tracks: readonly Track[]): boolean {
  return !track.muted && (!tracks.some((entry) => entry.solo) || track.solo);
}
