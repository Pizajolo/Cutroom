import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Lock, Unlock } from 'lucide-react';
import type { TimelineDoc, TimelineItem, Track } from '@shared/schema/timeline';
import type { Op } from '@shared/timeline/types';
import { applyOp } from '@shared/timeline/ops';
import { MEDIA_DRAG_TYPE } from '../../media/types';
import { previewClock } from '../preview/store';
import { useSelection } from '../selection/store';
import { addMedia, quantize, useEditor } from '../store';
import { useAssistant } from '../assistantStore';
import { indexIntervals, visibleItems } from './geometry';
import { itemLabel, moveSelection, type CopiedItem } from './commands';
import { ClipArtwork } from './ClipArtwork';

export const TRACK_NAMES: Record<Track['kind'], string> = { overlay: 'Overlays / Motion', text: 'Text', captions: 'Captions', video: 'Video (main)', broll: 'B-roll', voiceover: 'Voiceover', music: 'Music', sfx: 'SFX' };
export type ApplyTimeline = (ops: Op[], label: string) => Promise<unknown>;
export interface Ghost { items: CopiedItem[]; originalIds: string[]; error?: string }
export interface MenuTarget { track: Track; item?: TimelineItem; time: number; x: number; y: number; trigger: HTMLElement }
export interface TemporaryEdit { itemId: string; rightItemId?: string; kind: 'slip' | 'roll'; onChange: (value: number) => void; onComplete: () => void }
export interface SnapGuide { time: number; label: string }
interface Props { doc: TimelineDoc; track: Track; start: number; end: number; zoom: number; snapping: boolean; ripple: boolean; tool: 'selection' | 'cut'; apply?: ApplyTimeline; temporary?: TemporaryEdit; ghost: Ghost | null; setGhost: (ghost: Ghost | null) => void; setGuide: (guide: SnapGuide | null) => void; onMenu: (target: MenuTarget) => void; onNote: (text: string) => void; onFocusTrack: (id: string) => void }
export function TrackLane({ doc, track, start, end, zoom, snapping, ripple, tool, apply, temporary, ghost, setGhost, setGuide, onMenu, onNote, onFocusTrack }: Props) {
  const index = useMemo(() => indexIntervals(track.items), [track.items]);
  const selected = useSelection((s) => s.elements);
  const changes = useAssistant((s) => s.changes);
  const media = useEditor((s) => s.media);
  const fps = doc.format.fps;
  const items = visibleItems(index, start, end);
  const gesture = useRef<{ item: TimelineItem; ids: string[]; x: number; y: number; lastX: number; lastY: number; scroll: HTMLDivElement; scrollLeft: number; edge: 'start' | 'end' | null; moved: boolean; bypass: boolean; ops: Op[]; note?: string; error?: string; temporary?: TemporaryEdit; lastFrame: number } | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; endX: number; endY: number; additive: string[] } | null>(null);
  const marqueeActive = useRef(false);
  const frame = useRef<number | null>(null);
  const cancel = useCallback(() => { gesture.current = null; setGhost(null); setGuide(null); if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null; }, [setGhost, setGuide]);
  useEffect(() => { const escape = (e: KeyboardEvent) => { if (e.key === 'Escape' && (gesture.current || marqueeActive.current)) { e.preventDefault(); e.stopPropagation(); const action = gesture.current?.temporary; marqueeActive.current = false; setMarquee(null); cancel(); action?.onComplete(); } }; window.addEventListener('keydown', escape, true); return () => { window.removeEventListener('keydown', escape, true); if (frame.current !== null) cancelAnimationFrame(frame.current); }; }, [cancel]);
  const update = (now: number) => {
    const drag = gesture.current;
    if (!drag) return;
    const bounds = drag.scroll.getBoundingClientRect();
    const header = drag.scroll.querySelector<HTMLElement>('[data-track-header]')?.offsetWidth ?? 180;
    const edge = 32;
    const speed = drag.lastX < bounds.left + header + edge ? -Math.min(1, (bounds.left + header + edge - drag.lastX) / edge) : drag.lastX > bounds.right - edge ? Math.min(1, (drag.lastX - bounds.right + edge) / edge) : 0;
    const elapsed = Math.min(50, now - drag.lastFrame); drag.lastFrame = now;
    if (drag.moved && speed) drag.scroll.scrollLeft += speed * .6 * elapsed;
    const dx = drag.lastX - drag.x + drag.scroll.scrollLeft - drag.scrollLeft;
    if (Math.abs(dx) < 3 && Math.abs(drag.lastY - drag.y) < 3 && !drag.moved) return;
    drag.moved = true;
    let time = quantize((drag.edge === 'end' ? drag.item.start + drag.item.duration : drag.item.start) + dx / zoom, fps);
    let guide: SnapGuide | null = null;
    if (snapping && !drag.bypass && !drag.temporary) {
      const range = useSelection.getState().range;
      const edges: SnapGuide[] = [{ time: previewClock.getSnapshot().time, label: 'Playhead' }, ...doc.tracks.flatMap((t) => t.items.filter((i) => !drag.ids.includes(i.id)).flatMap((i) => [{ time: i.start, label: 'Clip start' }, { time: i.start + i.duration, label: 'Clip end' }])), ...(range ? [{ time: range.start, label: 'In' }, { time: range.end, label: 'Out' }] : []), ...doc.markers.map((m) => ({ time: m.time, label: m.label || 'Marker' })), { time: 0, label: 'Zero' }];
      for (const target of edges) if (Math.abs(target.time - time) * zoom <= 8 && (!guide || Math.abs(target.time - time) < Math.abs(guide.time - time))) guide = target;
      if (guide) time = guide.time;
    }
    setGuide(guide);
    let entries: CopiedItem[] = [], error: string | undefined;
    try {
      if (drag.temporary) {
        const action = drag.temporary;
        const op: Op = action.kind === 'slip' ? { type: 'slipItem', itemId: drag.item.id, delta: dx / zoom * (drag.item.type === 'clip' ? drag.item.speed : 1) } : { type: 'rollEdit', leftItemId: drag.item.id, rightItemId: action.rightItemId!, time: Math.max(0, drag.item.start + drag.item.duration + dx / zoom) };
        const sourceDurations = Object.fromEntries(media.filter((f) => f.probe).map((f) => [f.rel, f.probe!.duration]));
        const result = applyOp(doc, op, { sourceDurations });
        entries = result.doc.tracks.flatMap((t) => t.items.filter((i) => drag.ids.includes(i.id)).map((item) => ({ trackId: t.id, item })));
        const changed = entries.find((e) => e.item.id === drag.item.id)!.item;
        const value = action.kind === 'slip' && 'in' in changed && 'in' in drag.item ? changed.in - drag.item.in : changed.start + changed.duration;
        drag.ops = [op.type === 'slipItem' ? { ...op, delta: value } : { ...op, time: value }];
        action.onChange(value);
      } else if (drag.edge) {
        const item = drag.item, speed = item.type === 'clip' ? item.speed : 1;
        const duration = item.type === 'clip' || item.type === 'audio' ? media.find((f) => f.rel === item.src)?.probe?.duration : undefined;
        const min = drag.edge === 'start' ? Math.max(0, item.start - ('in' in item ? item.in / speed : item.start)) : item.start + 1 / fps;
        const max = drag.edge === 'start' ? item.start + item.duration - 1 / fps : duration !== undefined && 'out' in item ? item.start + item.duration + (duration - item.out) / speed : Infinity;
        time = Math.max(min, Math.min(max, time));
        const op: Op = { type: ripple ? 'rippleTrim' : 'trimItem', itemId: item.id, edge: drag.edge, time };
        drag.ops = [op];
        const result = applyOp(doc, op);
        entries = result.doc.tracks.flatMap((t) => t.items.filter((i) => i.id === item.id).map((i) => ({ trackId: t.id, item: i })));
      } else {
        const lanes = [...drag.scroll.querySelectorAll<HTMLElement>('[data-track-id]')];
        const target = lanes.find((lane) => { const rect = lane.getBoundingClientRect(); return drag.lastY >= rect.top && drag.lastY < rect.bottom; });
        const targetIndex = doc.tracks.findIndex((t) => t.id === (target?.dataset.trackId ?? track.id));
        const trackDelta = targetIndex - doc.tracks.findIndex((t) => t.id === track.id);
        const delta = Math.max(time - drag.item.start, -Math.min(...doc.tracks.flatMap((t) => t.items.filter((i) => drag.ids.includes(i.id) && !t.locked).map((i) => i.start))));
        entries = doc.tracks.flatMap((t, index) => t.locked ? [] : t.items.filter((i) => drag.ids.includes(i.id)).map((item) => ({ trackId: doc.tracks[index + trackDelta]?.id ?? t.id, item: { ...item, start: quantize(item.start + delta, fps) } })));
        const command = moveSelection(doc, drag.ids, delta, trackDelta); drag.ops = command.ops; drag.note = command.note;
      }
    } catch (r) { error = r instanceof Error ? r.message : 'This placement is unavailable.'; drag.ops = []; }
    drag.error = error;
    if (!entries.length && error) entries = [{ trackId: track.id, item: drag.item }];
    setGhost({ items: entries, originalIds: drag.ids, error });
  };
  const tick = (now: number) => { update(now); if (gesture.current) frame.current = requestAnimationFrame(tick); };
  const menu = (trigger: HTMLElement, x: number, y: number, item?: TimelineItem) => { onFocusTrack(track.id); onMenu({ track, item, time: item?.start ?? quantize((x - trigger.getBoundingClientRect().left) / zoom, fps), x, y, trigger }); };
  return <div className={`timeline-track track-${track.kind}${track.locked ? ' track-locked' : ''}`}>
    <div className="track-header" data-track-header><span className="track-name" title={TRACK_NAMES[track.kind]}>{TRACK_NAMES[track.kind]}</span><button className="track-toggle" aria-label={`Lock ${TRACK_NAMES[track.kind]}`} aria-pressed={!!track.locked} disabled={!apply} onClick={() => void apply?.([{ type: 'setTrack', trackId: track.id, locked: !track.locked }], 'Toggle track lock')}>{track.locked ? <Lock size={12} /> : <Unlock size={12} />}</button>{(['muted', 'solo'] as const).map((key) => <button key={key} className="track-toggle" aria-label={`${key === 'muted' ? 'Mute' : 'Solo'} ${TRACK_NAMES[track.kind]}`} aria-pressed={track[key]} disabled={!apply} onClick={() => void apply?.([{ type: 'setTrack', trackId: track.id, [key]: !track[key] }], `${key === 'muted' ? track.muted ? 'Unmute' : 'Mute' : track.solo ? 'Unsolo' : 'Solo'} ${TRACK_NAMES[track.kind]}`)}>{key === 'muted' ? 'M' : 'S'}</button>)}</div>
    <div className={`track-lane${track.muted ? ' track-muted' : ''}`} data-track-id={track.id} data-track-kind={track.kind} tabIndex={0} aria-label={`${TRACK_NAMES[track.kind]} track drop area`} onFocus={() => onFocusTrack(track.id)}
      onContextMenu={(e) => { if (e.target !== e.currentTarget) return; e.preventDefault(); menu(e.currentTarget, e.clientX, e.clientY); }}
      onKeyDown={(e) => { if (e.target !== e.currentTarget) return; if (e.key === 'ContextMenu' || e.key === 'F10' && e.shiftKey) { e.preventDefault(); const rect = e.currentTarget.getBoundingClientRect(); onMenu({ track, time: previewClock.getSnapshot().time, x: Math.max(rect.left, 180), y: rect.top, trigger: e.currentTarget }); } }}
      onPointerDown={(e) => { if (e.target !== e.currentTarget || e.button !== 0) return; onFocusTrack(track.id); e.currentTarget.setPointerCapture(e.pointerId); marqueeActive.current = true; setMarquee({ x: e.clientX, y: e.clientY, endX: e.clientX, endY: e.clientY, additive: e.shiftKey ? selected.map((s) => s.itemId) : [] }); }}
      onPointerMove={(e) => { if (marquee && e.currentTarget.hasPointerCapture(e.pointerId)) setMarquee({ ...marquee, endX: e.clientX, endY: e.clientY }); }}
      onPointerUp={(e) => { if (!marquee || !marqueeActive.current) return; marqueeActive.current = false; const lanes = [...e.currentTarget.closest('.timeline-scroll')!.querySelectorAll<HTMLElement>('[data-track-id]')]; const ids = [...marquee.additive]; if (Math.abs(e.clientX - marquee.x) > 3 || Math.abs(e.clientY - marquee.y) > 3) for (const lane of lanes) { const rect = lane.getBoundingClientRect(); if (Math.max(marquee.y, e.clientY) < rect.top || Math.min(marquee.y, e.clientY) > rect.bottom) continue; const a = (Math.min(marquee.x, e.clientX) - rect.left) / zoom, b = (Math.max(marquee.x, e.clientX) - rect.left) / zoom; ids.push(...(doc.tracks.find((t) => t.id === lane.dataset.trackId)?.items.filter((i) => i.start <= b && i.start + i.duration >= a).map((i) => i.id) ?? [])); } useSelection.setState({ elements: [...new Set(ids)].map((itemId) => ({ itemId })) }); setMarquee(null); if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
      onPointerCancel={() => { marqueeActive.current = false; setMarquee(null); }}
      onDragOver={(e) => { if (e.dataTransfer.types.includes(MEDIA_DRAG_TYPE)) { e.preventDefault(); e.dataTransfer.dropEffect = track.locked ? 'none' : 'copy'; } }}
      onDrop={(e) => { if (!apply || !e.dataTransfer.types.includes(MEDIA_DRAG_TYPE)) return; e.preventDefault(); if (track.locked) { onNote('This track is locked.'); return; } try { const data: unknown = JSON.parse(e.dataTransfer.getData(MEDIA_DRAG_TYPE)); const rel = data && typeof data === 'object' && 'rel' in data ? data.rel : null; const file = media.find((f) => f.rel === rel); if (!file) return; const audioTrack = ['music', 'voiceover', 'sfx'].includes(track.kind); if ((file.kind === 'audio') !== audioTrack || !audioTrack && !['video', 'broll'].includes(track.kind)) { onNote(audioTrack ? 'This track accepts audio.' : 'Use the Video or B-roll track for visual media.'); return; } void addMedia(file, quantize((e.clientX - e.currentTarget.getBoundingClientRect().left) / zoom, fps), track); } catch { onNote('This media drop could not be read.'); } }}>
      {items.map((item) => <button type="button" key={item.id} data-item-id={item.id} className={`timeline-item item-${item.type}${selected.some((s) => s.itemId === item.id) ? ' item-selected' : ''}${changes.some((c) => c.itemId === item.id) ? ' item-agent-changed' : ''}${ghost?.originalIds.includes(item.id) ? ' item-moving' : ''}`} style={{ left: item.start * zoom, width: item.duration * zoom, cursor: temporary?.itemId === item.id && temporary.kind === 'slip' ? 'ew-resize' : undefined }} aria-label={`${itemLabel(item)}, ${TRACK_NAMES[track.kind]}, start ${item.start.toFixed(3)} seconds, duration ${item.duration.toFixed(3)} seconds`} aria-pressed={selected.some((s) => s.itemId === item.id)} title={itemLabel(item)}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); if (!selected.some((s) => s.itemId === item.id)) useSelection.getState().select({ itemId: item.id }); menu(e.currentTarget, e.clientX, e.clientY, item); }}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); useSelection.getState().clear(); } else if (e.key === 'ContextMenu' || e.key === 'F10' && e.shiftKey) { e.preventDefault(); const rect = e.currentTarget.getBoundingClientRect(); menu(e.currentTarget, rect.left, rect.bottom, item); } }}
        onPointerDown={(e) => { if (e.button !== 0) return; e.stopPropagation(); onFocusTrack(track.id); const wasSelected = selected.some((s) => s.itemId === item.id); if (e.shiftKey || !wasSelected) useSelection.getState().select({ itemId: item.id }, e.shiftKey); if (!apply || track.locked) { if (track.locked) onNote("1 locked clip wasn't changed."); return; } if (e.shiftKey && wasSelected) return; if (tool === 'cut' && temporary?.itemId !== item.id) { const at = quantize(item.start + (e.clientX - e.currentTarget.getBoundingClientRect().left) / zoom, fps); if (at > item.start && at < item.start + item.duration) void apply([{ type: 'splitItem', itemId: item.id, at }], 'Cut clip'); return; } const rect = e.currentTarget.getBoundingClientRect(); const scroll = e.currentTarget.closest<HTMLDivElement>('.timeline-scroll')!; const action = temporary?.itemId === item.id ? temporary : undefined; if (action?.kind === 'roll' && rect.right - e.clientX > 12) return; gesture.current = { item, temporary: action, lastFrame: e.timeStamp, ids: action ? [item.id, ...(action.rightItemId ? [action.rightItemId] : [])] : useSelection.getState().elements.map((s) => s.itemId), x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, scroll, scrollLeft: scroll.scrollLeft, edge: action ? null : e.clientX - rect.left < 8 ? 'start' : rect.right - e.clientX < 8 ? 'end' : null, moved: false, bypass: e.metaKey || e.ctrlKey, ops: [] }; e.currentTarget.setPointerCapture(e.pointerId); frame.current = requestAnimationFrame(tick); }}
        onPointerMove={(e) => { const drag = gesture.current; if (drag) { drag.lastX = e.clientX; drag.lastY = e.clientY; drag.bypass = e.metaKey || e.ctrlKey; } }}
        onPointerCancel={() => { const action = gesture.current?.temporary; cancel(); action?.onComplete(); }}
        onPointerUp={(e) => { const drag = gesture.current; if (drag) { update(e.timeStamp); if (drag.moved && drag.ops.length) { if (drag.note) onNote(drag.note); void apply?.(drag.ops, drag.temporary ? drag.temporary.kind === 'slip' ? 'Slip source' : 'Roll cut' : drag.edge ? ripple ? 'Ripple trim (this track only)' : 'Trim clip' : 'Move clips').then((result) => { if (result !== false) drag.temporary?.onComplete(); }); } else if (drag.moved && drag.error) onNote(drag.error); } cancel(); if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
        onClick={(e) => { if (e.detail === 0) useSelection.getState().select({ itemId: item.id }, e.shiftKey); }} onDoubleClick={() => previewClock.seek(item.start)}>
        {item.duration * zoom >= 24 && <ClipArtwork key={'src' in item ? item.src : item.id} item={item} file={'src' in item ? media.find((f) => f.rel === item.src) : undefined} zoom={zoom} start={start} end={end} />}<span className="clip-title">{itemLabel(item)}</span>{temporary?.itemId === item.id && temporary.kind === 'roll' && <span className="roll-cut-handle" aria-hidden="true" />}
      </button>)}
      {ghost?.items.filter((e) => e.trackId === track.id).map(({ item }) => <div key={item.id} className={`timeline-ghost${ghost.error ? ' invalid-ghost' : ''}`} style={{ left: item.start * zoom, width: item.duration * zoom }}><span>{ghost.error ?? `${itemLabel(item)} · ${item.start.toFixed(2)}s${'in' in item ? ` · source ${item.in.toFixed(2)}–${item.out.toFixed(2)}s` : ''}`}</span></div>)}
      {marquee && <div className="timeline-marquee" style={{ position: 'fixed', left: Math.min(marquee.x, marquee.endX), top: Math.min(marquee.y, marquee.endY), width: Math.abs(marquee.endX - marquee.x), height: Math.abs(marquee.endY - marquee.y) }} />}
    </div>
  </div>;
}
