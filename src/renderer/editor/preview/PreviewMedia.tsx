import { useEffect, useMemo, useRef, useState } from 'react';
import type { TimelineDoc, Track } from '@shared/schema/timeline';
import type { MediaFile } from '@shared/schema/media';
import { isTrackEnabled } from '@shared/timeline/visibility';
import { previewClock } from './store';
import { activeAt, sourceTime, itemVolume, isTrackAudible, type MediaItem } from './media';

function Source({ item, track, tracks, file }: { item: MediaItem; track: Track; tracks: Track[]; file: MediaFile }) {
  const element = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  useEffect(() => {
    const media = element.current;
    if (!media) return;
    const sync = () => {
      const clock = previewClock.getSnapshot();
      const target = sourceTime(item, clock.time);
      if (Math.abs(media.currentTime - target) > (clock.playing ? 0.18 : 0.005)) media.currentTime = target;
      media.volume = isTrackAudible(track, tracks) ? itemVolume(item, clock.time) : 0;
      const rate = clock.rate * (item.type === 'clip' ? item.speed : 1);
      if (rate > 0 && rate <= 16) media.playbackRate = Math.max(0.0625, rate);
      if (clock.playing && rate > 0) { if (media.paused) void media.play().catch(() => { /* Retry on the next user playback gesture. */ }); }
      else media.pause();
    };
    sync(); const off = previewClock.subscribe(sync);
    media.addEventListener('loadedmetadata', sync);
    return () => { off(); media.removeEventListener('loadedmetadata', sync); media.pause(); };
  }, [item, track, tracks, file.url]);
  if (file.kind === 'image') return <img className={`preview-media preview-${track.kind}`} src={file.url} alt="" />;
  return track.kind === 'video' || track.kind === 'broll'
    ? <video className={`preview-media preview-${track.kind}`} ref={element} src={file.url} preload="auto" playsInline />
    : <audio ref={element} src={file.url} preload="auto" />;
}
function TrackLayer({ track, tracks, files }: { track: Track; tracks: Track[]; files: MediaFile[] }) {
  const [items, setItems] = useState<MediaItem[]>([]);
  useEffect(() => {
    const sync = () => {
      const next = track.items.filter((i): i is MediaItem => (i.type === 'clip' || i.type === 'audio') && activeAt(i, previewClock.getSnapshot().time));
      setItems((previous) => next.length === previous.length && next.every((item, index) => item === previous[index]) ? previous : next);
    };
    sync(); return previewClock.subscribe(sync);
  }, [track]);
  // Every active audio item has its own element; overlapping music/SFX are mixed.
  return <>{items.map((item) => { const file = files.find((f) => f.rel === item.src); return file ? <Source key={item.id} item={item} file={file} track={track} tracks={tracks} /> : null; })}</>;
}
export function PreviewMedia({ doc, files }: { doc: TimelineDoc; files: MediaFile[] }) {
  const nextSources = useMemo(() => doc.tracks.filter((t) => isTrackEnabled(t, doc.tracks) && (t.kind === 'video' || t.kind === 'broll')).flatMap((t) => t.items.filter((i) => i.type === 'clip')).sort((a, b) => a.start - b.start), [doc]);
  const [next, setNext] = useState<string | null>(null);
  useEffect(() => {
    const sync = () => {
      const clip = nextSources.find((i) => i.start > previewClock.getSnapshot().time);
      setNext(clip?.type === 'clip' ? files.find((f) => f.rel === clip.src)?.url ?? null : null);
    };
    sync(); return previewClock.subscribe(sync);
  }, [nextSources, files]);
  return <>{['video', 'broll', 'voiceover', 'music', 'sfx'].map((kind) => { const track = doc.tracks.find((t) => t.kind === kind); return track && isTrackEnabled(track, doc.tracks) ? <TrackLayer key={track.id} track={track} tracks={doc.tracks} files={files} /> : null; })}{next && <video className="preview-preload" src={next} preload="auto" muted aria-hidden="true" />}</>;
}
