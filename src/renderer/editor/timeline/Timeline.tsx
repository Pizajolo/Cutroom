import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { AlignHorizontalSpaceAround, Magnet, Minus, Plus, Scissors, Type, ZoomIn } from 'lucide-react';
import type { TimelineDoc, TimelineItem, Track } from '@shared/schema/timeline';
import { TRACK_KINDS } from '@shared/schema/timeline';
import type { Op } from '@shared/timeline/types';
import { formatDuration } from '../../lib/time';
import { keymap } from '../../lib/keymap';
import { previewClock, useClock } from '../preview/store';
import { useSelection } from '../selection/store';
import { indexIntervals, rulerInterval, visibleItems } from './geometry';

export const TRACK_NAMES: Record<Track['kind'], string> = {
  overlay: 'Overlays / Motion', text: 'Text', captions: 'Captions', video: 'Video (main)', broll: 'B-roll', voiceover: 'Voiceover', music: 'Music', sfx: 'SFX',
};
export type ApplyTimeline = (ops: Op[], label: string) => Promise<void>;
const itemLabel = (item: TimelineItem): string => item.type === 'text' ? item.text : item.type === 'caption' ? item.words.map((word) => word.text).join(' ') : item.type === 'composition' ? item.path : item.src.split('/').pop() ?? item.src;
const durationOf = (doc: TimelineDoc | null) => Math.max(0, ...(doc?.tracks.flatMap((track) => track.items.map((item) => item.start + item.duration)) ?? []));

function Playhead({ zoom }: { zoom: number }) {
  const time = useClock((state) => state.time);
  return <div className="timeline-playhead" style={{ '--playhead-x': `${time * zoom}px` } as CSSProperties} aria-hidden="true"><span /></div>;
}

function TrackLane({ track, start, end, zoom, apply }: { track: Track; start: number; end: number; zoom: number; apply?: ApplyTimeline }) {
  const index = useMemo(() => indexIntervals(track.items), [track.items]);
  const selected = useSelection((state) => state.elements);
  const select = useSelection((state) => state.select);
  const items = visibleItems(index, start, end);
  return <div className={`timeline-track track-${track.kind}`}>
    <div className="track-header" data-track-header>
      <span className="track-name" title={TRACK_NAMES[track.kind]}>{TRACK_NAMES[track.kind]}</span>
      <button type="button" className="track-toggle" aria-label={`Mute ${TRACK_NAMES[track.kind]}`} aria-pressed={track.muted} disabled={!apply}
        onClick={() => { void apply?.([{ type: 'setTrack', trackId: track.id, muted: !track.muted }], `${track.muted ? 'Unmute' : 'Mute'} ${track.name}`); }}>M</button>
      <button type="button" className="track-toggle" aria-label={`Solo ${TRACK_NAMES[track.kind]}`} aria-pressed={track.solo} disabled={!apply}
        onClick={() => { void apply?.([{ type: 'setTrack', trackId: track.id, solo: !track.solo }], `${track.solo ? 'Unsolo' : 'Solo'} ${track.name}`); }}>S</button>
    </div>
    <div className={`track-lane${track.muted ? ' track-muted' : ''}`} data-track-kind={track.kind}>
      {items.map((item) => <button type="button" key={item.id} className={`timeline-item item-${item.type}${selected.some((entry) => entry.itemId === item.id) ? ' item-selected' : ''}`}
        style={{ left: item.start * zoom, width: item.duration * zoom }}
        aria-label={`${itemLabel(item)}, ${TRACK_NAMES[track.kind]}, start ${item.start.toFixed(3)} seconds, duration ${item.duration.toFixed(3)} seconds`}
        aria-pressed={selected.some((entry) => entry.itemId === item.id)} title={itemLabel(item)}
        tabIndex={selected[0]?.itemId === item.id || !selected.length && items[0]?.id === item.id ? 0 : -1}
        onClick={(event) => select({ itemId: item.id }, event.shiftKey)} onDoubleClick={() => previewClock.seek(item.start)}>
        <span>{itemLabel(item)}</span>
      </button>)}
    </div>
  </div>;
}

export function Timeline({ doc, apply, onError }: { doc: TimelineDoc | null; apply?: ApplyTimeline; onError?: (message: string) => void }) {
  const [zoom, setZoom] = useState(64);
  const [viewport, setViewport] = useState({ left: 0, width: 0 });
  const scroll = useRef<HTMLDivElement>(null);
  const clear = useSelection((state) => state.clear);
  const duration = durationOf(doc);
  const guardedApply: ApplyTimeline | undefined = apply ? async (ops, label) => {
    try { await apply(ops, label); } catch (reason) { onError?.(reason instanceof Error ? reason.message : 'The timeline change could not be saved.'); }
  } : undefined;
  useEffect(() => {
    const element = scroll.current;
    if (!element) return;
    const measure = () => setViewport({ left: element.scrollLeft, width: Math.max(0, element.clientWidth - (element.querySelector<HTMLElement>('[data-track-header]')?.offsetWidth ?? 0)) });
    let active = true;
    queueMicrotask(() => { if (active) measure(); });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => { active = false; observer?.disconnect(); };
  }, []);
  const tracks = doc?.tracks ?? TRACK_KINDS.map((kind) => ({ id: kind, kind, name: TRACK_NAMES[kind], muted: false, solo: false, items: [] }));
  useEffect(() => {
    const unregister = [
      keymap.register({ id: 'timeline-zoom-in', key: '=', command: true, scope: 'timeline', run: () => setZoom((value) => Math.min(512, value * 2)) }),
      keymap.register({ id: 'timeline-zoom-out', key: '-', command: true, scope: 'timeline', run: () => setZoom((value) => Math.max(4, value / 2)) }),
      keymap.register({ id: 'timeline-fit', key: 'z', shift: true, scope: 'timeline', enabled: () => duration > 0, run: () => setZoom(Math.max(4, Math.min(512, viewport.width / (duration * 1.05)))) }),
    ];
    return () => unregister.forEach((remove) => remove());
  }, [duration, viewport.width]);
  const width = Math.max(viewport.width, Math.max(30, duration * 1.05) * zoom);
  const start = Math.max(0, viewport.left / zoom - 1);
  const end = (viewport.left + viewport.width) / zoom + 1;
  const interval = rulerInterval(zoom, doc?.format.fps ?? 30);
  const ticks: number[] = [];
  for (let time = Math.max(0, Math.floor(start / interval) * interval); time <= end; time += interval) ticks.push(time);
  const seek = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    previewClock.seek((event.clientX - bounds.left) / zoom);
  };
  return <section className="timeline" aria-label="Timeline" data-workspace-region tabIndex={-1}
    onFocusCapture={() => keymap.setScopes(['editor', 'timeline'])}
    onBlurCapture={(event) => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) keymap.setScopes(['editor']); }}>
    <div className="timeline-toolbar">
      <button type="button" className="icon-button" aria-label="Selection tool" aria-pressed="true" title="Selection tool (V)"><AlignHorizontalSpaceAround size={16} /></button>
      <button type="button" className="icon-button" aria-label="Cut tool unavailable" title="Timeline editing is not connected" disabled><Scissors size={16} /></button>
      <span className="toolbar-divider" />
      <button type="button" className="icon-button" aria-label="Snapping unavailable" disabled title="Snapping will be available with timeline editing"><Magnet size={16} /></button>
      <button type="button" className="button quiet-button" disabled><Type size={14} />Add text</button>
      <span className="timeline-summary">{doc ? 'Select a clip to inspect it' : 'Timeline not connected'}</span>
      <div className="timeline-zoom"><button type="button" className="icon-button" aria-label="Zoom out" disabled={zoom <= 4} onClick={() => setZoom(Math.max(4, zoom / 2))}><Minus size={14} /></button>
        <span aria-label={`${zoom} pixels per second`}>{zoom} px/s</span>
        <button type="button" className="icon-button" aria-label="Zoom in" disabled={zoom >= 512} onClick={() => setZoom(Math.min(512, zoom * 2))}><Plus size={14} /></button>
        <button type="button" className="button quiet-button" disabled={!duration} onClick={() => setZoom(Math.max(4, Math.min(512, viewport.width / (duration * 1.05))))}><ZoomIn size={14} />Fit</button>
      </div>
    </div>
    <div className="timeline-scroll" ref={scroll} onScroll={(event) => { const left = event.currentTarget.scrollLeft; setViewport((value) => ({ ...value, left })); }}
      onKeyDown={(event) => { if (event.key === 'Escape') clear(); }}>
      <div className="timeline-content" style={{ '--lane-width': `${width}px` } as CSSProperties}>
        <div className="timeline-ruler-row"><div className="ruler-header">{doc ? 'Timeline' : 'Eight fixed tracks'}</div>
          <div className="timeline-ruler" role="group" tabIndex={0} aria-label="Time ruler; click to seek, or use left and right arrows to step frames"
            onPointerDown={(event) => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); seek(event); }}
            onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) seek(event); }}
            onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
            onKeyDown={(event) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); if (event.key === 'Home') previewClock.seek(0); else if (event.key === 'End') previewClock.seek(duration); else previewClock.step((event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 10 : 1)); } }}>
            {ticks.map((time) => <span className="ruler-tick" key={time} style={{ left: time * zoom }}>{formatDuration(time)}</span>)}
          </div>
        </div>
        {tracks.map((track) => <TrackLane key={track.id} track={track} start={start} end={end} zoom={zoom} apply={guardedApply} />)}
        <Playhead zoom={zoom} />
      </div>
    </div>
  </section>;
}
