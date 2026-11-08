import type { Thumbnails, Waveform } from '@shared/schema/media';
import { api } from '../../lib/api';
import { useNavigation } from '../../state/navigation';

const thumbnails = new Map<string, Promise<Thumbnails | null>>();
const waveforms = new Map<string, Promise<Waveform | null>>();
function cached<T>(cache: Map<string, Promise<T | null>>, rel: string, load: () => Promise<T>) {
  let value = cache.get(rel);
  if (!value) {
    value = load().catch(() => null); cache.set(rel, value);
    if (cache.size > 128) cache.delete(cache.keys().next().value!);
  }
  return value;
}
export const sourceThumbnails = (rel: string) => cached(thumbnails, rel, () => api.invoke('media.thumbnails', { rel }));
export const sourceWaveform = (rel: string) => cached(waveforms, rel, () => api.invoke('media.waveform', { rel }));
useNavigation.subscribe((next, previous) => { if (next.project?.project.id !== previous.project?.project.id) { thumbnails.clear(); waveforms.clear(); } });
