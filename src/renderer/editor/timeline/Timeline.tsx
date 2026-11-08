import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { History, Magnet, Minus, MousePointer2, Plus, Scissors, Type } from 'lucide-react';
import { TRACK_KINDS, NO_OVERLAP_TRACKS, type Marker, type TimelineDoc } from '@shared/schema/timeline';
import type { HistoryEntry } from '@shared/schema/editor';
import { formatDuration } from '../../lib/time';
import { keymap, type Shortcut } from '../../lib/keymap';
import { api } from '../../lib/api';
import { Dialog } from '../../components/Dialog';
import { Notice } from '../../components/Notice';
import { previewClock, useClock } from '../preview/store';
import { useSelection } from '../selection/store';
import { addText } from '../store';
import { errorMessage, useNavigation } from '../../state/navigation';
import { rulerInterval } from './geometry';
import { TrackLane, TRACK_NAMES, type ApplyTimeline, type Ghost, type MenuTarget, type SnapGuide } from './TrackLane';
import { deleteSelection, endOf, itemLabel, nudge, selectForward, split, trimSelection, type Command } from './commands';
import { copy, duplicate, pasteClipboard } from './clipboard';
import { addMarker } from './navigation';
export { TRACK_NAMES } from './TrackLane';
export type { ApplyTimeline } from './TrackLane';
const EMPTY_DOC: TimelineDoc = { version: 1, format: { width: 1920, height: 1080, aspect: '16:9', fps: 30 }, tracks: TRACK_KINDS.map((kind) => ({ id: kind, kind, name: TRACK_NAMES[kind], muted: false, solo: false, items: [] })), markers: [] };
function Playhead({ zoom }: { zoom: number }) { const time = useClock((s) => s.time); return <div className="timeline-playhead" style={{ '--playhead-x': `${time * zoom}px` } as CSSProperties} aria-hidden="true"><span /></div>; }

export function Timeline({ doc, apply, onError }: { doc: TimelineDoc | null; apply?: ApplyTimeline; onError?: (message: string) => void }) {
  const [zoom, setZoom] = useState(64), zoomRef = useRef(zoom);
  const [snapping, setSnapping] = useState(true), [ripple, setRipple] = useState(false);
  const [tool, setTool] = useState<'selection' | 'cut'>('selection');
  const [focusedTrack, setFocusedTrack] = useState<string | null>(null);
  const [ghost, setGhost] = useState<Ghost | null>(null), [guide, setGuide] = useState<SnapGuide | null>(null);
  const [note, setNote] = useState('');
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [form, setForm] = useState<{ target: MenuTarget; kind: 'slip' | 'roll' | 'gap'; value: string } | null>(null);
  const [formError, setFormError] = useState('');
  const [formBusy, setFormBusy] = useState(false);
  const [marker, setMarker] = useState<Marker | null>(null);
  const [selectedMarker, setSelectedMarker] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [viewport, setViewport] = useState({ left: 0, width: 0 });
  const scroll = useRef<HTMLDivElement>(null);
  const range = useSelection((s) => s.range);
  const selected = useSelection((s) => s.elements);
  const current = doc ?? EMPTY_DOC;
  const duration = Math.max(0, ...current.tracks.flatMap((t) => t.items.map(endOf)));
  const timelineWidth = Math.max(duration, ...current.markers.map((m) => m.time), range?.end ?? 0);
  const rulerDrag = useRef<{ anchor: number; edge?: 'start' | 'end'; range: boolean } | null>(null);
  const execute = useCallback(async (command: Command, label: string) => { if (command.note) setNote(command.note); if (!command.ops.length || !apply) return false; try { return await apply(command.ops, label) !== false; } catch (r) { onError?.(errorMessage(r)); return false; } }, [apply, onError]);
  const guardedApply: ApplyTimeline | undefined = apply ? (ops, label) => execute({ ops }, label) : undefined;
  const command = (create: () => Command, label: string) => { try { void execute(create(), label); } catch (r) { setNote(errorMessage(r)); } };
  const closeForm = () => { form?.target.trigger.focus(); setForm(null); setFormError(''); setTool('selection'); };
  const closeMenu = () => { menu?.trigger.focus(); setMenu(null); };
  const zoomAt = useCallback((next: number, anchor?: number) => {
    const element = scroll.current; if (!element) return;
    const old = zoomRef.current, value = Math.max(4, Math.min(512, next));
    const playhead = previewClock.getSnapshot().time * old - element.scrollLeft;
    const point = anchor ?? (playhead >= 0 && playhead <= viewport.width ? playhead : viewport.width / 2);
    const time = (element.scrollLeft + point) / old;
    zoomRef.current = value; setZoom(value);
    requestAnimationFrame(() => { element.scrollLeft = Math.max(0, time * value - point); });
  }, [viewport.width]);
  useEffect(() => {
    const element = scroll.current; if (!element) return;
    const measure = () => setViewport({ left: element.scrollLeft, width: Math.max(0, element.clientWidth - (element.querySelector<HTMLElement>('[data-track-header]')?.offsetWidth ?? 180)) });
    measure(); const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure); observer?.observe(element);
    const wheel = (event: WheelEvent) => { if (!event.metaKey && !event.ctrlKey) return; event.preventDefault(); const header = element.querySelector<HTMLElement>('[data-track-header]')?.offsetWidth ?? 180; zoomAt(zoomRef.current * Math.exp(-event.deltaY * .01), event.clientX - element.getBoundingClientRect().left - header); };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => { observer?.disconnect(); element.removeEventListener('wheel', wheel); };
  }, [zoomAt]);
  useEffect(() => previewClock.subscribe((clock) => { const element = scroll.current; if (!element || !clock.playing || !viewport.width) return; const x = clock.time * zoom; if (x < element.scrollLeft || x > element.scrollLeft + viewport.width) element.scrollLeft = Math.max(0, x - viewport.width * (clock.rate > 0 ? .2 : .8)); }), [zoom, viewport.width]);
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const outside = (event: globalThis.PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenu(null); };
    document.addEventListener('pointerdown', outside); return () => document.removeEventListener('pointerdown', outside);
  }, [menu]);
  useEffect(() => {
    if (!doc) return;
    const ids = () => useSelection.getState().elements.map((e) => e.itemId);
    const at = () => previewClock.getSnapshot().time;
    const run = (create: () => Command, label: string) => { try { void execute(create(), label); } catch (r) { setNote(errorMessage(r)); } };
    const bindings: Shortcut[] = [
      { id: 'fit-selection', key: 'f', shift: true, scope: 'editor', run: () => { const range = useSelection.getState().range; const items = doc.tracks.flatMap((t) => t.items.filter((i) => ids().includes(i.id))); const start = range?.start ?? Math.min(...items.map((i) => i.start)), end = range?.end ?? Math.max(...items.map(endOf)); if (Number.isFinite(start) && end > start) { const value = viewport.width / ((end - start) * 1.05); zoomAt(value, 0); requestAnimationFrame(() => { if (scroll.current) scroll.current.scrollLeft = start * zoomRef.current; }); } } },
      ...[-1, 1].map((direction): Shortcut => ({ id: `focus-track-${direction}`, key: direction < 0 ? 'ArrowUp' : 'ArrowDown', alt: true, scope: 'editor', run: () => { const index = doc.tracks.findIndex((t) => t.id === focusedTrack); scroll.current?.querySelectorAll<HTMLElement>('[data-track-id]')[Math.max(0, Math.min(doc.tracks.length - 1, index + direction))]?.focus(); } })),
      { id: 'mute-focused', key: 'm', shift: true, scope: 'editor', run: () => { const track = doc.tracks.find((t) => t.id === focusedTrack); if (track) void execute({ ops: [{ type: 'setTrack', trackId: track.id, muted: !track.muted }] }, 'Toggle focused track mute'); } },
      ...[false, true].map((shift): Shortcut => ({ id: `clip-traversal-${shift}`, key: 'Tab', shift, scope: 'timeline', enabled: () => !!scroll.current?.contains(document.activeElement) && !document.activeElement?.closest('button:not(.timeline-item), input, [role=slider]'), run: () => { const items = doc.tracks.flatMap((t) => t.items.map((item) => ({ trackId: t.id, item }))).sort((a, b) => a.item.start - b.item.start); const index = items.findIndex((e) => ids().includes(e.item.id)); const entry = items[(index + (shift ? -1 : 1) + items.length) % items.length]; if (!entry) return; useSelection.getState().select({ itemId: entry.item.id }); setFocusedTrack(entry.trackId); if (scroll.current) scroll.current.scrollLeft = Math.max(0, entry.item.start * zoomRef.current - viewport.width / 2); requestAnimationFrame(() => scroll.current?.querySelector<HTMLButtonElement>(`[data-item-id="${entry.item.id}"]`)?.focus()); } })),
      { id: 'timeline-snapping', key: 'n', scope: 'editor', run: () => setSnapping((v) => !v) },
      { id: 'timeline-ripple', key: 'r', scope: 'editor', run: () => setRipple((v) => !v) },
      { id: 'selection-tool', key: 'v', scope: 'editor', run: () => setTool('selection') },
      { id: 'cut-tool', key: 'c', scope: 'editor', run: () => setTool('cut') },
      ...[false, true].map((all): Shortcut => ({ id: `split-${all}`, key: 's', shift: all, scope: 'editor', run: () => run(() => split(doc, ids(), at(), all, focusedTrack), all ? 'Split all unlocked tracks' : 'Split at playhead') })),
      ...[-1, 1].flatMap((direction) => [false, true].map((shift): Shortcut => ({ id: `nudge-${direction}-${shift}`, key: direction < 0 ? 'ArrowLeft' : 'ArrowRight', alt: true, shift, scope: 'editor', repeat: true, run: () => run(() => nudge(doc, ids(), direction * (shift ? 10 : 1)), 'Nudge clips') }))),
      ...['Backspace', 'Delete'].flatMap((key) => [false, true].map((shift): Shortcut => ({ id: `delete-${key}-${shift}`, key, shift, scope: 'editor', run: () => { if (selectedMarker) { void execute({ ops: [{ type: 'deleteMarker', markerId: selectedMarker }] }, 'Delete marker'); setSelectedMarker(null); } else run(() => deleteSelection(doc, ids(), ripple || shift), ripple || shift ? 'Ripple delete (this track only)' : 'Delete clips'); } }))),
      { id: 'select-all', key: 'a', command: true, scope: 'editor', run: () => useSelection.setState({ elements: doc.tracks.flatMap((t) => t.items.map((i) => ({ itemId: i.id }))) }) },
      { id: 'select-forward', key: 'a', scope: 'editor', run: () => useSelection.setState({ elements: selectForward(doc, ids(), at()) }) },
      { id: 'copy', key: 'c', command: true, scope: 'editor', run: () => { copy(doc, ids()); setNote('Clips copied.'); } },
      { id: 'cut', key: 'x', command: true, scope: 'editor', run: () => { const result = deleteSelection(doc, ids(), false); copy(doc, result.ops.flatMap((op) => 'itemId' in op ? [op.itemId] : [])); void execute(result, 'Cut clips'); } },
      { id: 'paste', key: 'v', command: true, scope: 'editor', run: () => run(() => pasteClipboard(doc, at()), 'Paste clips') },
      { id: 'duplicate', key: 'd', command: true, scope: 'editor', run: () => run(() => duplicate(doc, ids()), 'Duplicate clips') },
      ...(['start', 'end'] as const).map((edge): Shortcut => ({ id: `trim-${edge}`, key: edge === 'start' ? 'q' : 'w', scope: 'editor', run: () => run(() => trimSelection(doc, ids(), at(), edge, ripple), 'Trim to playhead') })),
      { id: 'timeline-zoom-in', key: '=', command: true, scope: 'timeline', run: () => zoomAt(zoomRef.current * 2) },
      { id: 'timeline-zoom-out', key: '-', command: true, scope: 'timeline', run: () => zoomAt(zoomRef.current / 2) },
      { id: 'timeline-fit', key: 'z', shift: true, scope: 'editor', run: () => { zoomAt(viewport.width / (duration * 1.05 || 1), 0); if (scroll.current) scroll.current.scrollLeft = 0; } },
      { id: 'history', key: 'h', shift: true, scope: 'editor', run: () => { void api.invoke('timeline.history', {}).then(setHistory).catch((r: unknown) => setNote(errorMessage(r))); } },
    ];
    const remove = bindings.map((b) => keymap.register(b)); return () => remove.forEach((r) => r());
  }, [doc, execute, ripple, focusedTrack, selectedMarker, zoomAt, duration, viewport.width]);
  const width = Math.max(viewport.width, Math.max(30, timelineWidth * 1.05) * zoom);
  const start = Math.max(0, viewport.left / zoom - 1), end = (viewport.left + viewport.width) / zoom + 1;
  const interval = rulerInterval(zoom, current.format.fps), ticks: number[] = [];
  for (let time = Math.max(0, Math.floor(start / interval) * interval); time <= end; time += interval) ticks.push(time);
  const rulerTime = (event: PointerEvent<HTMLDivElement>) => Math.max(0, Math.round((event.clientX - event.currentTarget.getBoundingClientRect().left) / zoom * current.format.fps) / current.format.fps);
  const rulerMove = (event: PointerEvent<HTMLDivElement>) => { if (!rulerDrag.current) return; const time = rulerTime(event), drag = rulerDrag.current; if (drag.range) useSelection.getState().setRange(drag.anchor, time); else previewClock.seek(time); };
  const adjacent = menu?.item ? [...menu.track.items].sort((a, b) => a.start - b.start).find((i) => Math.abs(i.start - endOf(menu.item!)) < 1e-8) : undefined;
  const formAdjacent = form?.target.item ? form.target.track.items.find((i) => Math.abs(i.start - endOf(form.target.item!)) < 1e-8) : undefined;
  const applyForm = async () => {
    if (!form || formBusy) return;
    const value = Number(form.value); if (!form.value.trim() || !Number.isFinite(value) || form.kind !== 'slip' && value <= 0) { setFormError('Enter a valid time.'); return; }
    setFormBusy(true); setFormError('');
    const op = form.kind === 'gap' ? { type: 'insertGap' as const, trackId: form.target.track.id, at: form.target.time, duration: value } : form.kind === 'slip' ? { type: 'slipItem' as const, itemId: form.target.item!.id, delta: value } : formAdjacent ? { type: 'rollEdit' as const, leftItemId: form.target.item!.id, rightItemId: formAdjacent.id, time: value } : null;
    if (op && await execute({ ops: [op] }, form.kind === 'gap' ? 'Insert gap' : form.kind === 'slip' ? 'Slip source' : 'Roll cut')) closeForm(); else setFormError('The edit was not saved. Review the time and try again.');
    setFormBusy(false);
  };
  const menuAction = (action: () => void) => { closeMenu(); setFormError(''); action(); };
  return <section className={`timeline tool-${tool}`} aria-label="Timeline" data-workspace-region tabIndex={-1} onKeyDownCapture={(e) => { if (form && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeForm(); } }} onFocusCapture={() => keymap.setScopes(['editor', 'timeline'])} onBlurCapture={(e) => { if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) keymap.setScopes(['editor']); }}>
    <div className="timeline-toolbar"><button className="icon-button" aria-label="Selection tool" aria-pressed={tool === 'selection'} title="Selection (V)" onClick={() => setTool('selection')}><MousePointer2 size={16} /></button><button className="icon-button" aria-label="Cut tool" aria-pressed={tool === 'cut'} title="Cut (C)" disabled={!apply} onClick={() => setTool('cut')}><Scissors size={16} /></button><span className="toolbar-divider" /><button className="button quiet-button" aria-pressed={ripple} title="Ripple affects this track only (R)" onClick={() => setRipple(!ripple)}>Ripple</button><button className="icon-button" aria-label="Snapping" aria-pressed={snapping} title="Snap (N); hold ⌘ to bypass" onClick={() => setSnapping(!snapping)}><Magnet size={16} /></button><button className="button quiet-button" disabled={!apply} onClick={addText}><Type size={14} />Add text</button><button className="button quiet-button" disabled={!apply} onClick={addMarker}>Marker</button><button className="icon-button" aria-label="History" onClick={() => void api.invoke('timeline.history', {}).then(setHistory).catch((r: unknown) => setNote(errorMessage(r)))}><History size={16} /></button><span className="timeline-summary">{range ? `In ${formatDuration(range.start)} / Out ${formatDuration(range.end)}` : selected.length ? `${selected.length} selected` : 'Select a clip to edit'}</span><div className="timeline-zoom"><button className="icon-button" aria-label="Zoom out" disabled={zoom <= 4} onClick={() => zoomAt(zoom / 2)}><Minus size={14} /></button><input type="range" aria-label="Timeline zoom" min={2} max={9} step={.01} value={Math.log2(zoom)} onChange={(e) => zoomAt(2 ** Number(e.target.value))} /><button className="icon-button" aria-label="Zoom in" disabled={zoom >= 512} onClick={() => zoomAt(zoom * 2)}><Plus size={14} /></button><button className="button quiet-button" disabled={!duration} onClick={() => { zoomAt(viewport.width / (duration * 1.05), 0); if (scroll.current) scroll.current.scrollLeft = 0; }}>Fit</button></div></div>
    {!doc && <p className="sr-only" role="status">Loading timeline…</p>}
    {note && <div className="timeline-note" role="status">{note}<button className="button quiet-button" onClick={() => setNote('')}>Dismiss</button></div>}
    <div className="timeline-scroll" ref={scroll} onScroll={(e) => setViewport((v) => ({ ...v, left: e.currentTarget.scrollLeft }))}><div className="timeline-content" style={{ '--lane-width': `${width}px` } as CSSProperties}>
      <div className="timeline-ruler-row"><div className="ruler-header">Timeline</div><div className="timeline-ruler" role="group" tabIndex={0} aria-label="Time ruler; Shift-drag to set In and Out" onKeyDown={(e) => { if (e.target !== e.currentTarget || e.altKey || e.metaKey || e.ctrlKey) return; if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); previewClock.step((e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1)); } else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); e.stopPropagation(); previewClock.seek(e.key === 'Home' ? 0 : duration); } }} onPointerDown={(e) => { if (e.button !== 0 || e.target !== e.currentTarget) return; setSelectedMarker(null); const time = rulerTime(e); rulerDrag.current = { anchor: time, range: e.shiftKey }; e.currentTarget.setPointerCapture(e.pointerId); rulerMove(e); }} onPointerMove={rulerMove} onPointerUp={(e) => { rulerDrag.current = null; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }} onPointerCancel={() => { rulerDrag.current = null; }}>
        {ticks.map((time) => <span className="ruler-tick" key={time} style={{ left: time * zoom }}>{formatDuration(time)}</span>)}
        {range && <><div className="timeline-range" style={{ left: range.start * zoom, width: (range.end - range.start) * zoom }} />{(['start', 'end'] as const).map((edge) => <div key={edge} className={`range-handle range-${edge}`} role="slider" tabIndex={0} aria-label={edge === 'start' ? 'In point' : 'Out point'} aria-valuemin={0} aria-valuemax={Math.max(duration, range.end)} aria-valuenow={range[edge]} title={`${edge === 'start' ? 'In' : 'Out'} ${range[edge].toFixed(3)}s`} style={{ left: range[edge] * zoom }} onPointerDown={(e) => { e.stopPropagation(); rulerDrag.current = { anchor: range[edge === 'start' ? 'end' : 'start'], edge, range: true }; e.currentTarget.parentElement!.setPointerCapture(e.pointerId); }} onKeyDown={(e) => { if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return; e.preventDefault(); e.stopPropagation(); const time = Math.max(0, range[edge] + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1) / current.format.fps); useSelection.getState().setRange(edge === 'start' ? time : range.start, edge === 'end' ? time : range.end); }} />)}</>}
        {current.markers.map((m) => <button className={`timeline-marker marker-${m.kind}`} key={m.id} style={{ left: m.time * zoom }} aria-label={`Marker: ${m.label}, ${m.time.toFixed(3)} seconds`} title={m.label} aria-pressed={selectedMarker === m.id} onClick={(e) => { e.stopPropagation(); setSelectedMarker(m.id); previewClock.seek(m.time); }} onDoubleClick={() => setMarker(m)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setMarker(m); } }}>◆</button>)}
      </div></div>
      {current.tracks.map((track) => <TrackLane key={track.id} doc={current} track={track} start={start} end={end} zoom={zoom} snapping={snapping} ripple={ripple} tool={tool} apply={guardedApply} temporary={form && form.kind !== 'gap' ? { itemId: form.target.item!.id, rightItemId: formAdjacent?.id, kind: form.kind, onChange: (value) => setForm((previous) => previous ? { ...previous, value: String(value) } : null), onComplete: closeForm } : undefined} ghost={ghost} setGhost={setGhost} setGuide={setGuide} onMenu={setMenu} onNote={setNote} onFocusTrack={(id) => { setFocusedTrack(id); setSelectedMarker(null); }} />)}
      {!duration && <span className="timeline-drop-hint">Drag media onto Video, B-roll or an audio track.</span>}
      {guide && <div className="timeline-snap-guide" style={{ left: `calc(var(--timeline-header-width) + ${guide.time * zoom}px)` }}><span>{guide.label}</span></div>}
      <Playhead zoom={zoom} />
    </div></div>
    {menu && <div ref={menuRef} role="menu" className="timeline-context-menu" aria-label={menu.item ? 'Clip actions' : 'Gap actions'} style={{ left: Math.max(0, Math.min(menu.x, window.innerWidth - 272)), top: Math.max(0, Math.min(menu.y, window.innerHeight - 420)) }} onKeyDown={(e) => { const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]; const index = buttons.indexOf(document.activeElement as HTMLButtonElement); if (e.key === 'Tab') { closeMenu(); } else if (e.key === 'Escape') { e.preventDefault(); closeMenu(); } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) { e.preventDefault(); buttons[e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus(); } }}>
      {menu.item ? <>
        <button role="menuitem" aria-disabled={!!menu.track.locked} onClick={() => menuAction(() => command(() => split(current, [menu.item!.id], previewClock.getSnapshot().time), 'Split at playhead'))}>Split at playhead</button>
        <button role="menuitem" aria-disabled={!!menu.track.locked} onClick={() => menuAction(() => command(() => duplicate(current, selected.some((s) => s.itemId === menu.item!.id) ? selected.map((s) => s.itemId) : [menu.item!.id]), 'Duplicate clips'))}>Duplicate</button>
        <button role="menuitem" onClick={() => menuAction(() => { copy(current, selected.some((s) => s.itemId === menu.item!.id) ? selected.map((s) => s.itemId) : [menu.item!.id]); setNote('Clips copied.'); })}>Copy</button>
        <button role="menuitem" aria-disabled={!!menu.track.locked} onClick={() => menuAction(() => { const result = deleteSelection(current, selected.some((s) => s.itemId === menu.item!.id) ? selected.map((s) => s.itemId) : [menu.item!.id], false); copy(current, result.ops.flatMap((op) => 'itemId' in op ? [op.itemId] : [])); void execute(result, 'Cut clip'); })}>Cut</button>
        {[false, true].map((rippling) => <button key={String(rippling)} role="menuitem" aria-disabled={!!menu.track.locked} onClick={() => menuAction(() => command(() => deleteSelection(current, selected.some((s) => s.itemId === menu.item!.id) ? selected.map((s) => s.itemId) : [menu.item!.id], ripple || rippling), rippling ? 'Ripple delete (this track only)' : 'Delete clips'))}>{rippling ? 'Ripple delete' : 'Delete'}</button>)}
        <button role="menuitem" disabled={menu.track.locked || !['clip', 'audio'].includes(menu.item.type)} title="Available for unlocked media clips" onClick={() => menuAction(() => setForm({ target: menu, kind: 'slip', value: '0' }))}>Slip source…</button>
        <button role="menuitem" disabled={menu.track.locked || !adjacent || !['clip', 'audio'].includes(menu.item.type) || adjacent.type !== menu.item.type} title={adjacent ? 'Move the shared cut; keep outer bounds fixed' : 'Requires a compatible adjacent clip'} onClick={() => menuAction(() => setForm({ target: menu, kind: 'roll', value: String(endOf(menu.item!)) }))}>Roll cut…</button>
        {!(NO_OVERLAP_TRACKS as readonly string[]).includes(menu.track.kind) && [1, -1].map((direction) => <button role="menuitem" key={direction} disabled={menu.track.locked} onClick={() => menuAction(() => void guardedApply?.([{ type: 'reorderItem', itemId: menu.item!.id, index: Math.max(0, Math.min(menu.track.items.length - 1, menu.track.items.findIndex((i) => i.id === menu.item!.id) + direction)) }], 'Change clip stacking'))}>{direction > 0 ? 'Bring forward' : 'Send backward'}</button>)}
        <button role="menuitem" onClick={() => menuAction(() => previewClock.seek(menu.item!.start))}>Seek to start</button><button role="menuitem" onClick={() => menuAction(() => { useSelection.getState().select({ itemId: menu.item!.id }); useNavigation.setState({ dock: 'Inspector' }); })}>Inspect</button>
      </> : <><button role="menuitem" onClick={() => menuAction(() => previewClock.seek(menu.time))}>Seek here</button><button role="menuitem" disabled={menu.track.locked} onClick={() => menuAction(() => void guardedApply?.([{ type: 'closeGap', trackId: menu.track.id, at: menu.time }], 'Close gap'))}>Close gap</button><button role="menuitem" disabled={menu.track.locked} onClick={() => menuAction(() => setForm({ target: menu, kind: 'gap', value: '1' }))}>Insert gap…</button></>}{menu.track.locked && <p className="field-note">Track locked. Editing actions skip locked clips.</p>}
    </div>}
    {marker && <Dialog title="Edit marker" onClose={() => setMarker(null)} footer={<><button className="button" onClick={() => setMarker(null)}>Cancel</button><button className="button danger" onClick={() => { void guardedApply?.([{ type: 'deleteMarker', markerId: marker.id }], 'Delete marker'); setMarker(null); }}>Delete</button><button className="button primary" onClick={() => { void guardedApply?.([{ type: 'updateMarker', markerId: marker.id, patch: { label: marker.label } }], 'Update marker'); setMarker(null); }}>Save</button></>}><label className="form-field">Label<input autoFocus value={marker.label} onChange={(e) => setMarker({ ...marker, label: e.target.value })} /></label></Dialog>}
    {form && <section role="dialog" aria-modal="false" aria-label={form.kind === 'gap' ? 'Insert gap' : form.kind === 'slip' ? 'Slip source' : 'Roll cut'} className="timeline-edit-form" onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeForm(); } else if (e.key === 'Enter') { e.preventDefault(); void applyForm(); } }}><h3>{form.kind === 'gap' ? 'Insert gap' : form.kind === 'slip' ? 'Slip source' : 'Roll cut'}</h3><p className="field-note">{form.target.track.name}{form.kind === 'gap' ? ` at ${form.target.time.toFixed(3)} seconds. Later clips on this track move.` : ` · ${itemLabel(form.target.item!)}`}</p><label className="form-field">{form.kind === 'gap' ? 'Duration (seconds)' : form.kind === 'slip' ? 'Source offset (seconds)' : 'Cut time'}<input autoFocus type="number" step={1 / current.format.fps} disabled={formBusy} value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} /></label><p className="field-note">{form.kind === 'slip' ? 'Drag this clip horizontally, or enter an offset. Timeline bounds stay fixed.' : form.kind === 'roll' ? 'Drag the clip’s shared cut, or enter a time. Outer bounds stay fixed.' : 'Ripple affects this track only.'}</p>{formError && <p role="alert" className="field-error">{formError}</p>}<div className="form-row"><button className="button" disabled={formBusy} onClick={closeForm}>Cancel</button><button className="button primary" disabled={formBusy || !form.value.trim() || !Number.isFinite(Number(form.value)) || form.kind !== 'slip' && Number(form.value) <= 0} onClick={() => void applyForm()}>{formBusy ? 'Saving…' : 'Apply'}</button></div></section>}
    {history && <Dialog title="History" onClose={() => setHistory(null)}><ul className="recent-list">{history.map((entry) => <li key={entry.id}><span>{entry.label}</span><small>{entry.actor} · revision {entry.revision}</small></li>)}</ul>{!history.length && <Notice>No edits yet.</Notice>}</Dialog>}
  </section>;
}
