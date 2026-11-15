import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import {
  Copy, Eye, EyeOff, Flag, Gauge, Headphones, Layers, Lock, LockOpen, Maximize2, Plus, Redo2, Scissors, Trash2, Undo2, Unlink, Volume2, VolumeX, ZoomIn, ZoomOut,
} from 'lucide-react';
import { EMPTY_TIMELINE, timelineLength } from '../shared/types';
import type { Mark, MediaFile, Timeline as TimelineData } from '../shared/types';
import { Inspector } from './Inspector';
import { api, clock, useVideoTime } from './lib';
import { added, blocks, detached, dragged, duplicated, editPoints, patched, reordered, snap, split, trackPatched, trimmedTo, withSpeed } from './timelineOps';
import type { Block, Edge, Track } from './timelineOps';

interface Props {
  video: RefObject<HTMLVideoElement | null>;
  timeline: TimelineData | null;
  media: MediaFile[];
  onChange: (timeline: TimelineData) => void;
  onMark: (mark: Mark) => void;
  onUndo: () => void;
  onRedo: () => void;
}

type Drag = { block: Block; edge: Edge; x: number; draft: TimelineData };
const ROW = 30; // row height, pixels
const SNAP = 8; // snapping distance, pixels
const HEAD = 148; // track header width, pixels
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const TRACKS: { track: Track; title: string; picture: boolean }[] = [
  { track: 'overlays', title: 'Layers', picture: true },
  { track: 'clips', title: 'Main', picture: true },
  { track: 'audio', title: 'Audio', picture: false },
];
/** Ruler spacing: the smallest step that leaves room for a label. */
const TICKS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
const decibels = (v: number): string => (v <= 0 ? '−∞ dB' : `${(20 * Math.log10(v)).toFixed(1).replace('-', '−')} dB`);

/** Volume of the selected item. Shown live while dragging, saved once on release, so a drag is one undo step and one re-render. */
function VolumeSlider({ block, disabled, onCommit }: { block: Block; disabled: boolean; onCommit: (volume: number) => void }) {
  const [value, setValue] = useState(block.volume);
  useEffect(() => setValue(block.volume), [block.id, block.volume]);
  const commit = (): void => void (Math.abs(value - block.volume) > 0.001 && onCommit(value));
  return (
    <label className="volume" title={`Volume ${Math.round(value * 100)}% (${decibels(value)}). Double-click for 100%.`}>
      <input
        type="range" min={0} max={2} step={0.01} value={value} disabled={disabled} aria-label="Volume"
        onChange={(e) => setValue(Number(e.target.value))} onPointerUp={commit} onKeyUp={commit} onBlur={commit}
        onDoubleClick={() => (setValue(1), onCommit(1))}
      />
      <span>{Math.round(value * 100)}%</span>
    </label>
  );
}

/** Pro view: the same timeline.json Claude edits, laid out for direct manipulation. */
export function Timeline({ video, timeline: saved, media, onChange, onMark, onUndo, onRedo }: Props) {
  const timeline = saved ?? EMPTY_TIMELINE;
  const time = useVideoTime(video);
  const [selected, setSelected] = useState<string | null>(null);
  const [zoom, setZoom] = useState(60); // pixels per second
  const [drag, setDrag] = useState<Drag | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const shown = drag?.draft ?? timeline;
  const all = blocks(shown);
  const total = timelineLength(shown);
  const current = all.find((b) => b.id === selected);
  const locked = (track: Track): boolean => !!timeline.tracks?.[track]?.locked;
  /** The selection, if it may be changed. */
  const editable = current && !locked(current.track) ? current : undefined;
  const seek = (t: number): void => void (video.current && (video.current.currentTime = Math.max(0, Math.min(t, total))));
  const timeAt = (clientX: number): number => (clientX - content.current!.getBoundingClientRect().left - HEAD) / zoom;

  const remove = (): void => {
    if (!editable) return;
    const next = structuredClone(timeline);
    next[editable.track].splice(editable.index, 1);
    onChange(next);
  };
  // Split the selected item under the playhead, or else whichever clip is there.
  const cut = (): void => {
    const under = (b: Block): boolean => time > b.start && time < b.start + b.length;
    const target = editable && under(editable) ? editable : all.find((b) => b.track === 'clips' && under(b) && !locked('clips'));
    if (target) onChange(split(timeline, target, time));
  };
  const trackFor = (file: MediaFile, asLayer: boolean): Track => (file.kind === 'audio' ? 'audio' : asLayer || file.kind === 'image' ? 'overlays' : 'clips');
  const add = async (file: MediaFile, asLayer: boolean): Promise<void> => {
    if (locked(trackFor(file, asLayer))) return;
    onChange(added(timeline, file, await api.duration(file.path), time, asLayer));
  };
  const toggle = (key: 'muted' | 'hidden'): void => void (editable && !(key === 'hidden' && editable.track === 'audio') && onChange(patched(timeline, editable, { [key]: !editable[key] || undefined })));
  const canSpeed = !!editable && editable.track !== 'audio' && !editable.still;
  const canDetach = !!editable && editable.track === 'clips' && editable.speed === 1 && !editable.still && !editable.muted && !locked('audio');
  const jump = (direction: 1 | -1): void => {
    const points = editPoints(all);
    const to = direction > 0 ? points.find((p) => p > time + 0.01) : points.findLast((p) => p < time - 0.01);
    if (to !== undefined) seek(to);
  };
  const fit = (): void => setZoom(Math.max(4, Math.min(480, ((scroller.current?.clientWidth ?? 800) - HEAD - 40) / Math.max(total, 1))));

  // Keyboard: the shortcuts every editor has. Ignored while typing.
  const keys = useRef<(e: KeyboardEvent) => void>(null);
  keys.current = (e) => {
    if ((e.target as HTMLElement).closest('input, textarea, select')) return;
    const command = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    if (command && key === 'z') e.shiftKey ? onRedo() : onUndo();
    else if (command && key === 'd' && editable) onChange(duplicated(timeline, editable));
    else if (command) return;
    else if (e.key === 'Backspace' || e.key === 'Delete') remove();
    else if (key === 's') cut();
    else if (key === 'm') toggle('muted');
    else if (key === 'h') toggle('hidden');
    else if ((key === 'q' || key === 'w') && editable) onChange(trimmedTo(timeline, editable, key === 'q' ? 'start' : 'end', time));
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') jump(e.key === 'ArrowUp' ? -1 : 1);
    else if (e.key === 'Home' || e.key === 'End') seek(e.key === 'Home' ? 0 : total);
    else if (e.key === '=' || e.key === '+') setZoom((z) => Math.min(480, z * 1.5));
    else if (e.key === '-') setZoom((z) => Math.max(4, z / 1.5));
    else if (e.key === 'Z' && e.shiftKey) fit();
    else if (e.key === 'Escape') setSelected(null);
    else if (e.key === ' ') void (video.current?.paused ? video.current.play() : video.current?.pause());
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') seek(time + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : 1 / timeline.fps));
    else return;
    e.preventDefault();
  };
  useEffect(() => {
    const listener = (e: KeyboardEvent): void => keys.current?.(e);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  const startDrag = (event: React.PointerEvent, block: Block, edge: Edge): void => {
    event.stopPropagation();
    setSelected(block.id);
    if (locked(block.track)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ block, edge, x: event.clientX, draft: timeline });
  };
  const onMove = (event: React.PointerEvent): void => {
    if (!drag) return;
    const { block, edge } = drag;
    if (Math.abs(event.clientX - drag.x) < 3) return; // a click, not a drag
    if (block.track === 'clips' && edge === 'body') {
      // Dragging a clip reorders it: it lands before the first clip whose middle is right of the pointer.
      const at = timeAt(event.clientX);
      const others = blocks(timeline).filter((b) => b.track === 'clips' && b.id !== block.id);
      const to = others.filter((b) => b.start + b.length / 2 < at).length;
      return setDrag({ ...drag, draft: reordered(timeline, block.index, to) });
    }
    // Snap whichever edge is moving to the playhead and to neighbouring items.
    const edgeAt = edge === 'end' ? block.start + block.length : block.start;
    const dt = snap(edgeAt + (event.clientX - drag.x) / zoom, blocks(timeline), block.id, time, SNAP / zoom) - edgeAt;
    setDrag({ ...drag, draft: dragged(timeline, block, edge, dt) });
  };
  const endDrag = (): void => {
    if (drag && drag.draft !== timeline) onChange(drag.draft);
    setDrag(null);
  };

  const head = (track: Track, title: string, picture: boolean) => {
    const state = timeline.tracks?.[track] ?? {};
    const set = (patch: Parameters<typeof trackPatched>[2]): void => onChange(trackPatched(timeline, track, patch));
    return (
      <div className="lane-head" onPointerDown={(e) => e.stopPropagation()}>
        <span className="lane-title">{title}</span>
        {picture && (
          <button className={state.hidden ? 'ghost on' : 'ghost'} aria-pressed={!!state.hidden} title={state.hidden ? `Show ${title}` : `Hide ${title}`} onClick={() => set({ hidden: !state.hidden || undefined })}>
            {state.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        )}
        <button className={state.muted ? 'ghost on' : 'ghost'} aria-pressed={!!state.muted} title={state.muted ? `Unmute ${title}` : `Mute ${title}`} onClick={() => set({ muted: !state.muted || undefined })}>
          {state.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
        </button>
        <button className={state.solo ? 'ghost on solo' : 'ghost'} aria-pressed={!!state.solo} title={state.solo ? `Stop soloing ${title}` : `Solo ${title}: hear only soloed tracks`} onClick={() => set({ solo: !state.solo || undefined })}>
          <Headphones size={13} />
        </button>
        <button className={state.locked ? 'ghost on' : 'ghost'} aria-pressed={!!state.locked} title={state.locked ? `Unlock ${title}` : `Lock ${title}: no changes by you or Claude`} onClick={() => set({ locked: !state.locked || undefined })}>
          {state.locked ? <Lock size={13} /> : <LockOpen size={13} />}
        </button>
      </div>
    );
  };

  const lane = (track: Track, title: string, picture: boolean) => {
    const items = all.filter((b) => b.track === track);
    const classes = (b: Block): string =>
      ['block', b.id === selected && 'selected', !b.visible && picture && 'off', locked(track) && 'locked'].filter(Boolean).join(' ');
    return (
      <div key={track} className={`lane ${track}`} style={{ height: (Math.max(0, ...items.map((b) => b.row)) + 1) * ROW + 8 }}>
        {head(track, title, picture)}
        <div className="lane-body">
          {items.map((b) => (
            <div
              key={b.id} title={`${b.label} · ${clock(b.length)}${b.speed !== 1 ? ` · ${b.speed}×` : ''}`}
              className={classes(b)}
              style={{ left: b.start * zoom, top: b.row * ROW + 4, width: Math.max(4, b.length * zoom) }}
              onPointerDown={(e) => startDrag(e, b, 'body')} onPointerMove={onMove} onPointerUp={endDrag}
            >
              <i className="handle start" onPointerDown={(e) => startDrag(e, b, 'start')} />
              <span>{b.label}</span>
              {b.speed !== 1 && <em className="badge-speed">{b.speed}×</em>}
              {b.hidden && <EyeOff size={11} className="badge-icon" />}
              {(b.muted || (!b.audible && !(b.track === 'overlays' && b.volume === 0))) && !b.still && <VolumeX size={11} className="badge-icon" />}
              <i className="handle end" onPointerDown={(e) => startDrag(e, b, 'end')} />
            </div>
          ))}
        </div>
      </div>
    );
  };

  const step = TICKS.find((s) => s * zoom >= 64) ?? 600;
  const ticks = Array.from({ length: Math.floor((total + 2) / step) + 1 }, (_, i) => i * step);
  const speeds = editable && !SPEEDS.includes(editable.speed) ? [...SPEEDS, editable.speed].sort((a, b) => a - b) : SPEEDS;

  return (
    <section className="timeline">
      <div className="toolbar">
        <button className="ghost" onClick={onUndo} title="Undo (⌘Z)" aria-label="Undo"><Undo2 size={14} /></button>
        <button className="ghost" onClick={onRedo} title="Redo (⇧⌘Z)" aria-label="Redo"><Redo2 size={14} /></button>
        <span className="divider" />
        <button className="ghost" onClick={cut} title="Split at the playhead (S)"><Scissors size={14} /> Split</button>
        <button className="ghost" disabled={!editable} onClick={() => editable && onChange(duplicated(timeline, editable))} title="Duplicate (⌘D)" aria-label="Duplicate"><Copy size={14} /></button>
        <button className="ghost" disabled={!editable} onClick={remove} title="Delete (⌫)" aria-label="Delete"><Trash2 size={14} /></button>
        <span className="divider" />
        <label className="speed" title="Playback speed. The item gets shorter or longer to match.">
          <Gauge size={14} />
          <select
            disabled={!canSpeed} value={canSpeed ? editable.speed : 1} aria-label="Speed"
            onChange={(e) => editable && onChange(withSpeed(timeline, editable, Number(e.target.value)))}
          >
            {speeds.map((s) => <option key={s} value={s}>{s}×</option>)}
          </select>
        </label>
        {current && !current.still ? (
          <VolumeSlider block={current} disabled={!editable} onCommit={(volume) => editable && onChange(patched(timeline, editable, { volume }))} />
        ) : (
          <label className="volume" title="Select a clip or sound to set its volume"><input type="range" disabled aria-label="Volume" /><span /></label>
        )}
        <button
          className={editable?.muted ? 'ghost on' : 'ghost'} disabled={!editable || editable.still} aria-pressed={!!editable?.muted}
          title={editable?.muted ? 'Unmute (M)' : 'Mute (M)'} aria-label="Mute" onClick={() => toggle('muted')}
        >
          {editable?.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
        </button>
        <button
          className={editable?.hidden ? 'ghost on' : 'ghost'} disabled={!editable || editable.track === 'audio'} aria-pressed={!!editable?.hidden}
          title={editable?.hidden ? 'Show (H)' : 'Hide (H): the picture is switched off; on the main track it shows black'} aria-label="Hide" onClick={() => toggle('hidden')}
        >
          {editable?.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
        <button
          className="ghost" disabled={!canDetach} aria-label="Detach audio"
          title="Detach audio: move this clip's sound to the audio track, to move or trim it separately (J and L cuts)"
          onClick={() => editable && onChange(detached(timeline, editable))}
        >
          <Unlink size={14} />
        </button>
        <span className="divider" />
        <button
          disabled={!current} title="Point Claude at the selected item"
          onClick={() => current && onMark({ start: current.start, end: current.start + current.length, itemId: current.id })}
        >
          <Flag size={14} /> Mark for Claude
        </button>
        <span className="spacer" />
        <span className="timecode" title="Playhead / length">{clock(time)} / {clock(total)}</span>
        <button className="ghost" onClick={() => setZoom((z) => Math.max(4, z / 1.5))} title="Zoom out (−)" aria-label="Zoom out"><ZoomOut size={14} /></button>
        <button className="ghost" onClick={fit} title="Fit the whole edit (⇧Z)" aria-label="Zoom to fit"><Maximize2 size={14} /></button>
        <button className="ghost" onClick={() => setZoom((z) => Math.min(480, z * 1.5))} title="Zoom in (=)" aria-label="Zoom in"><ZoomIn size={14} /></button>
      </div>
      <div className="editor">
        <ul className="bin">
          {media.filter((file) => file.dir !== 'references' && file.dir !== 'exports' && file.kind !== 'other').map((file) => (
            <li key={file.path} title={file.path}>
              <span>{file.path.split('/').pop()}</span>
              <button className="ghost" disabled={locked(trackFor(file, false))} title={file.kind === 'video' ? 'Add to the end of the main track' : 'Add at the playhead'} aria-label="Add" onClick={() => void add(file, false)}><Plus size={14} /></button>
              {file.kind === 'video' && (
                <button className="ghost" disabled={locked('overlays')} title="Add as a layer on top, at the playhead (b-roll, picture-in-picture)" aria-label="Add as layer" onClick={() => void add(file, true)}><Layers size={14} /></button>
              )}
            </li>
          ))}
        </ul>
        <div className="tracks" ref={scroller}>
          <div
            className="content" ref={content} style={{ width: HEAD + total * zoom + 120 }}
            onPointerDown={(e) => {
              setSelected(null);
              seek(timeAt(e.clientX));
              e.currentTarget.setPointerCapture(e.pointerId);
              setScrubbing(true);
            }}
            onPointerMove={(e) => scrubbing && seek(timeAt(e.clientX))}
            onPointerUp={() => setScrubbing(false)}
          >
            <div className="ruler">
              <span className="ruler-head">{timeline.fps} fps</span>
              <div className="ruler-body">
                {ticks.map((t) => <span key={t} style={{ left: t * zoom }}>{clock(t).replace(/\.0$/, '')}</span>)}
              </div>
            </div>
            {TRACKS.map(({ track, title, picture }) => lane(track, title, picture))}
            <i className="playhead" style={{ left: HEAD + time * zoom }} />
          </div>
        </div>
        <Inspector timeline={timeline} block={current} locked={!!current && !editable} onChange={onChange} />
      </div>
    </section>
  );
}
