import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { AlignHorizontalSpaceAround, Magnet, Minus, Plus, Scissors, Type, ZoomIn } from 'lucide-react';
import type { TimelineDoc, TimelineItem, Track } from '@shared/schema/timeline';
import { TRACK_KINDS } from '@shared/schema/timeline';
import type { Op } from '@shared/timeline/types';
import { formatDuration } from '../../lib/time';
import { keymap } from '../../lib/keymap';
import { previewClock, useClock } from '../preview/store';
import { useSelection } from '../selection/store';
import { indexIntervals, rulerInterval, visibleItems } from './geometry';
import { addMedia, addText, quantize, useEditor } from '../store';
import { useAssistant } from '../assistantStore';
import { MEDIA_DRAG_TYPE } from '../../media/types';

export const TRACK_NAMES: Record<Track['kind'], string> = {
  overlay: 'Overlays / Motion', text: 'Text', captions: 'Captions', video: 'Video (main)', broll: 'B-roll', voiceover: 'Voiceover', music: 'Music', sfx: 'SFX',
};
export type ApplyTimeline = (ops: Op[], label: string) => Promise<unknown>;
const itemLabel = (item: TimelineItem): string => item.type === 'text' ? item.text : item.type === 'caption' ? item.words.map((word) => word.text).join(' ') : item.type === 'composition' ? item.path : item.src.split('/').pop() ?? item.src;
const durationOf = (doc: TimelineDoc | null) => Math.max(0, ...(doc?.tracks.flatMap((track) => track.items.map((item) => item.start + item.duration)) ?? []));

function Playhead({ zoom }: { zoom: number }) {
  const time = useClock((state) => state.time);
  return <div className="timeline-playhead" style={{ '--playhead-x': `${time * zoom}px` } as CSSProperties} aria-hidden="true"><span /></div>;
}

function TrackLane({ track, start, end, zoom, fps, snapping, apply }: { track: Track; start: number; end: number; zoom: number; fps: number; snapping: boolean; apply?: ApplyTimeline }) {
  const index = useMemo(() => indexIntervals(track.items), [track.items]);
  const selected = useSelection((state) => state.elements);
  const select = useSelection((state) => state.select);
  const changes = useAssistant((s) => s.changes);
  const [ghost, setGhost] = useState<{ id: string; start: number; duration: number } | null>(null);
  const gesture = useRef<{ id: string; x: number; start: number; duration: number; edge: 'start' | 'end' | null; moved: boolean } | null>(null);
  const items = visibleItems(index, start, end);
  const move = (event: PointerEvent<HTMLButtonElement>, item: TimelineItem) => {
    const drag = gesture.current;
    if (!drag || drag.id !== item.id || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const dx = event.clientX - drag.x;
    if (Math.abs(dx) < 3 && !drag.moved) return;
    drag.moved = true;
    const delta = dx / zoom;
    let time = quantize((drag.edge === 'end' ? drag.start + drag.duration : drag.start) + delta, fps);
    if (snapping && !event.metaKey) {
      const edges = [0, previewClock.getSnapshot().time, ...track.items.filter((i) => i.id !== item.id).flatMap((i) => [i.start, i.start + i.duration])];
      const nearest = edges.reduce((best, edge) => Math.abs(edge - time) < Math.abs(best - time) ? edge : best, Infinity);
      if (Math.abs(nearest - time) * zoom <= 8) time = nearest;
    }
    setGhost({ id: item.id, start: drag.edge === 'end' ? drag.start : time, duration: drag.edge === 'start' ? Math.max(1 / fps, drag.start + drag.duration - time) : drag.edge === 'end' ? Math.max(1 / fps, time - drag.start) : drag.duration });
  };
  return <div className={`timeline-track track-${track.kind}`}>
    <div className="track-header" data-track-header>
      <span className="track-name" title={TRACK_NAMES[track.kind]}>{TRACK_NAMES[track.kind]}</span>
      <button type="button" className="track-toggle" aria-label={`Mute ${TRACK_NAMES[track.kind]}`} aria-pressed={track.muted} disabled={!apply}
        onClick={() => { void apply?.([{ type: 'setTrack', trackId: track.id, muted: !track.muted }], `${track.muted ? 'Unmute' : 'Mute'} ${track.name}`); }}>M</button>
      <button type="button" className="track-toggle" aria-label={`Solo ${TRACK_NAMES[track.kind]}`} aria-pressed={track.solo} disabled={!apply}
        onClick={() => { void apply?.([{ type: 'setTrack', trackId: track.id, solo: !track.solo }], `${track.solo ? 'Unsolo' : 'Solo'} ${track.name}`); }}>S</button>
    </div>
    <div className={`track-lane${track.muted ? ' track-muted' : ''}`} data-track-kind={track.kind} aria-label={`${TRACK_NAMES[track.kind]} track drop area`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes(MEDIA_DRAG_TYPE)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }}
      onDrop={(e) => { if (!apply || !e.dataTransfer.types.includes(MEDIA_DRAG_TYPE)) return; e.preventDefault(); try { const data: unknown = JSON.parse(e.dataTransfer.getData(MEDIA_DRAG_TYPE)); const rel = data && typeof data === 'object' && 'rel' in data ? data.rel : null; const file = useEditor.getState().media.find((f) => f.rel === rel); if (!file) return; const audioTrack = ['music', 'voiceover', 'sfx'].includes(track.kind); if ((file.kind === 'audio') !== audioTrack || !audioTrack && !['video', 'broll'].includes(track.kind)) { useEditor.setState({ error: audioTrack ? 'This track accepts audio.' : 'Use the Video or B-roll track for visual media.' }); return; } void addMedia(file, quantize((e.clientX - e.currentTarget.getBoundingClientRect().left) / zoom, fps), track); } catch { useEditor.setState({ error: 'This media drop could not be read.' }); } }}>
      {items.map((item) => <button type="button" key={item.id} className={`timeline-item item-${item.type}${selected.some((entry) => entry.itemId === item.id) ? ' item-selected' : ''}${changes.some((c) => c.itemId === item.id) ? ' item-agent-changed' : ''}`}
        style={{ left: (ghost?.id === item.id ? ghost.start : item.start) * zoom, width: (ghost?.id === item.id ? ghost.duration : item.duration) * zoom }}
        aria-label={`${itemLabel(item)}, ${TRACK_NAMES[track.kind]}, start ${item.start.toFixed(3)} seconds, duration ${item.duration.toFixed(3)} seconds`}
        aria-pressed={selected.some((entry) => entry.itemId === item.id)} title={itemLabel(item)}
        tabIndex={selected[0]?.itemId === item.id || !selected.length && items[0]?.id === item.id ? 0 : -1}
        onPointerDown={(e) => { if (!apply || e.button !== 0) return; const bounds = e.currentTarget.getBoundingClientRect(); gesture.current = { id: item.id, x: e.clientX, start: item.start, duration: item.duration, edge: e.clientX - bounds.left < 8 ? 'start' : bounds.right - e.clientX < 8 ? 'end' : null, moved: false }; e.currentTarget.setPointerCapture(e.pointerId); select({ itemId: item.id }, e.shiftKey); }}
        onPointerMove={(e) => move(e, item)}
        onPointerCancel={() => { gesture.current = null; setGhost(null); }}
        onKeyDown={(e) => { if (e.key === 'Escape') { gesture.current = null; setGhost(null); } }}
        onPointerUp={(e) => { const drag = gesture.current; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); gesture.current = null; if (drag?.moved && ghost) { const op: Op = drag.edge ? { type: 'trimItem', itemId: item.id, edge: drag.edge, time: drag.edge === 'start' ? ghost.start : ghost.start + ghost.duration } : { type: 'moveItem', itemId: item.id, start: ghost.start }; void apply?.([op], drag.edge ? 'Trim clip' : 'Move clip'); } setGhost(null); }}
        onClick={(event) => select({ itemId: item.id }, event.shiftKey)} onDoubleClick={() => previewClock.seek(item.start)}>
        <span>{itemLabel(item)}</span>
      </button>)}
    </div>
  </div>;
}

export function Timeline({ doc, apply, onError }: { doc: TimelineDoc | null; apply?: ApplyTimeline; onError?: (message: string) => void }) {
  const [zoom, setZoom] = useState(64);
  const [listOpen, setListOpen] = useState(false);
  const [snapping, setSnapping] = useState(true);
  useEffect(() => keymap.register({ id: 'timeline-snapping', key: 'n', scope: 'editor', run: () => setSnapping((value) => !value) }), []);
  const split = useCallback(() => {
    const selected = useSelection.getState().elements;
    const time = quantize(previewClock.getSnapshot().time, doc?.format.fps ?? 30);
    const item = doc?.tracks.flatMap((t) => t.items).find((i) => selected.some((s) => s.itemId === i.id) && time > i.start && time < i.start + i.duration);
    if (item) void apply?.([{ type: 'splitItem', itemId: item.id, at: time }], 'Split at playhead');
  }, [doc, apply]);
  useEffect(() => {
    const remove = [keymap.register({ id: 'split', key: 's', scope: 'editor', run: split }), ...[false, true].map((ripple) => keymap.register({ id: `delete-${ripple}`, key: 'Backspace', shift: ripple, scope: 'editor', run: () => { const ids = useSelection.getState().elements.map((e) => e.itemId); const items = doc?.tracks.flatMap((t) => t.items).filter((i) => ids.includes(i.id)).sort((a, b) => b.start - a.start) ?? []; if (items.length) void apply?.(items.map((i) => ({ type: ripple ? 'rippleDelete' as const : 'deleteItem' as const, itemId: i.id })), ripple ? 'Ripple delete (this track only)' : 'Delete clips'); } }))];
    return () => remove.forEach((r) => r());
  }, [doc, apply, split]);
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
      <button type="button" className="icon-button" aria-label="Split at playhead" title="Split at playhead (S)" disabled={!apply} onClick={split}><Scissors size={16} /></button>
      <span className="toolbar-divider" />
      <button type="button" className="icon-button" aria-label="Snapping" aria-pressed={snapping} title="Toggle snapping (N); hold ⌘ to bypass" onClick={() => setSnapping(!snapping)}><Magnet size={16} /></button>
      <button type="button" className="button quiet-button" disabled={!apply} onClick={addText}><Type size={14} />Add text</button>
      <button type="button" className="button quiet-button" onClick={() => setListOpen(!listOpen)} aria-pressed={listOpen}>List view</button>
      <span className="timeline-summary">{doc ? 'Select a clip to inspect it' : 'Loading timeline…'}</span>
      <div className="timeline-zoom"><button type="button" className="icon-button" aria-label="Zoom out" disabled={zoom <= 4} onClick={() => setZoom(Math.max(4, zoom / 2))}><Minus size={14} /></button>
        <span aria-label={`${zoom} pixels per second`}>{zoom} px/s</span>
        <button type="button" className="icon-button" aria-label="Zoom in" disabled={zoom >= 512} onClick={() => setZoom(Math.min(512, zoom * 2))}><Plus size={14} /></button>
        <button type="button" className="button quiet-button" disabled={!duration} onClick={() => setZoom(Math.max(4, Math.min(512, viewport.width / (duration * 1.05))))}><ZoomIn size={14} />Fit</button>
      </div>
    </div>
    {listOpen && <div className="timeline-list"><table className="settings-table"><thead><tr><th>Item</th><th>Track</th><th>Start</th><th>End</th><th>Actions</th></tr></thead><tbody>{tracks.flatMap((track) => track.items.map((item) => <tr key={item.id}><td><button className="button quiet-button" onClick={() => useSelection.getState().select({ itemId: item.id })}>{itemLabel(item)}</button></td><td>{track.name}</td><td>{item.start.toFixed(3)}</td><td>{(item.start + item.duration).toFixed(3)}</td><td><button className="button" onClick={() => previewClock.seek(item.start)}>Seek</button><button className="button" disabled={!apply} onClick={() => { void apply?.([{ type: 'deleteItem', itemId: item.id }], 'Delete clip'); }}>Delete</button><button className="button" disabled={!apply} onClick={() => { void apply?.([{ type: 'rippleDelete', itemId: item.id }], 'Ripple delete (this track only)'); }}>Ripple delete</button></td></tr>))}</tbody></table></div>}
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
        {tracks.map((track) => <TrackLane key={track.id} track={track} start={start} end={end} zoom={zoom} fps={doc?.format.fps ?? 30} snapping={snapping} apply={guardedApply} />)}
        <Playhead zoom={zoom} />
      </div>
    </div>
  </section>;
}
