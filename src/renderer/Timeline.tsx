import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { Copy, Flag, Layers, Plus, Redo2, Scissors, Trash2, Undo2, ZoomIn, ZoomOut } from 'lucide-react';
import { EMPTY_TIMELINE, timelineLength } from '../shared/types';
import type { Mark, MediaFile, Timeline as TimelineData } from '../shared/types';
import { Inspector } from './Inspector';
import { api, clock, useVideoTime } from './lib';
import { added, blocks, dragged, duplicated, reordered, snap, split } from './timelineOps';
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

/** Pro view: the same timeline.json Claude edits, laid out for direct manipulation. */
export function Timeline({ video, timeline: saved, media, onChange, onMark, onUndo, onRedo }: Props) {
  const timeline = saved ?? EMPTY_TIMELINE;
  const time = useVideoTime(video);
  const [selected, setSelected] = useState<string | null>(null);
  const [zoom, setZoom] = useState(60); // pixels per second
  const [drag, setDrag] = useState<Drag | null>(null);
  const content = useRef<HTMLDivElement>(null);

  const shown = drag?.draft ?? timeline;
  const all = blocks(shown);
  const total = timelineLength(shown);
  const current = all.find((b) => b.id === selected);
  const seek = (t: number): void => void (video.current && (video.current.currentTime = Math.max(0, Math.min(t, total))));

  const remove = (): void => {
    if (!current) return;
    const next = structuredClone(timeline);
    next[current.track].splice(current.index, 1);
    onChange(next);
  };
  // Split the selected item under the playhead, or else whichever clip is there.
  const cut = (): void => {
    const under = (b: Block): boolean => time > b.start && time < b.start + b.length;
    const target = current && under(current) ? current : all.find((b) => b.track === 'clips' && under(b));
    if (target) onChange(split(timeline, target, time));
  };
  const add = async (file: MediaFile, asLayer: boolean): Promise<void> =>
    onChange(added(timeline, file, await api.duration(file.path), time, asLayer));

  // Keyboard: the shortcuts every editor has. Ignored while typing.
  const keys = useRef<(e: KeyboardEvent) => void>(null);
  keys.current = (e) => {
    if ((e.target as HTMLElement).closest('input, textarea, select')) return;
    const command = e.metaKey || e.ctrlKey;
    if (command && e.key === 'z') e.shiftKey ? onRedo() : onUndo();
    else if (command && e.key === 'd' && current) onChange(duplicated(timeline, current));
    else if (e.key === 'Backspace' || e.key === 'Delete') remove();
    else if (e.key === 's') cut();
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
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelected(block.id);
    setDrag({ block, edge, x: event.clientX, draft: timeline });
  };
  const onMove = (event: React.PointerEvent): void => {
    if (!drag) return;
    const { block, edge } = drag;
    if (Math.abs(event.clientX - drag.x) < 3) return; // a click, not a drag
    if (block.track === 'clips' && edge === 'body') {
      // Dragging a clip reorders it: it lands before the first clip whose middle is right of the pointer.
      const at = (event.clientX - content.current!.getBoundingClientRect().left) / zoom;
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

  const lane = (track: Track, title: string) => {
    const items = all.filter((b) => b.track === track);
    return (
      <div className={`lane ${track}`} style={{ height: (Math.max(0, ...items.map((b) => b.row)) + 1) * ROW + 8 }}>
        <span className="lane-title">{title}</span>
        {items.map((b) => (
          <div
            key={b.id} title={`${b.label} · ${clock(b.length)}`}
            className={b.id === selected ? 'block selected' : 'block'}
            style={{ left: b.start * zoom, top: b.row * ROW + 4, width: Math.max(4, b.length * zoom) }}
            onPointerDown={(e) => startDrag(e, b, 'body')} onPointerMove={onMove} onPointerUp={endDrag}
          >
            <i className="handle start" onPointerDown={(e) => startDrag(e, b, 'start')} />
            <span>{b.label}</span>
            <i className="handle end" onPointerDown={(e) => startDrag(e, b, 'end')} />
          </div>
        ))}
      </div>
    );
  };

  return (
    <section className="timeline">
      <div className="toolbar">
        <button className="ghost" onClick={onUndo} title="Undo (⌘Z)" aria-label="Undo"><Undo2 size={14} /></button>
        <button className="ghost" onClick={onRedo} title="Redo (⇧⌘Z)" aria-label="Redo"><Redo2 size={14} /></button>
        <button className="ghost" onClick={cut} title="Split at the playhead (S)"><Scissors size={14} /> Split</button>
        <button className="ghost" disabled={!current} onClick={() => current && onChange(duplicated(timeline, current))} title="Duplicate (⌘D)"><Copy size={14} /> Duplicate</button>
        <button className="ghost" disabled={!current} onClick={remove} title="Delete (⌫)"><Trash2 size={14} /> Delete</button>
        <button
          disabled={!current} title="Point Claude at the selected item"
          onClick={() => current && onMark({ start: current.start, end: current.start + current.length, itemId: current.id })}
        >
          <Flag size={14} /> Mark for Claude
        </button>
        <span className="spacer" />
        <span className="hint">Drag to move · drag edges to trim</span>
        <button className="ghost" onClick={() => setZoom((z) => Math.max(8, z / 1.5))} aria-label="Zoom out"><ZoomOut size={14} /></button>
        <button className="ghost" onClick={() => setZoom((z) => Math.min(480, z * 1.5))} aria-label="Zoom in"><ZoomIn size={14} /></button>
      </div>
      <div className="editor">
        <ul className="bin">
          {media.filter((file) => file.dir !== 'references' && file.dir !== 'exports' && file.kind !== 'other').map((file) => (
            <li key={file.path} title={file.path}>
              <span>{file.path.split('/').pop()}</span>
              <button className="ghost" title={file.kind === 'video' ? 'Add to the end of the main track' : 'Add at the playhead'} aria-label="Add" onClick={() => void add(file, false)}><Plus size={14} /></button>
              {file.kind === 'video' && (
                <button className="ghost" title="Add as a layer on top, at the playhead (b-roll, picture-in-picture)" aria-label="Add as layer" onClick={() => void add(file, true)}><Layers size={14} /></button>
              )}
            </li>
          ))}
        </ul>
        <div className="tracks">
          <div
            className="content" ref={content} style={{ width: total * zoom + 120 }}
            onPointerDown={(e) => (setSelected(null), seek((e.clientX - e.currentTarget.getBoundingClientRect().left) / zoom))}
          >
            {lane('overlays', 'Layers')}
            {lane('clips', 'Main')}
            {lane('audio', 'Audio')}
            <i className="playhead" style={{ left: time * zoom }} />
          </div>
        </div>
        <Inspector timeline={timeline} block={current} onChange={onChange} />
      </div>
    </section>
  );
}
