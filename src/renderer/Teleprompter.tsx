// A teleprompter for a script that still has to be recorded: big text scrolling at a pace the speaker sets.
import { useEffect, useRef, useState } from 'react';
import { FlipHorizontal2, Minus, Pause, Play, Plus, RotateCcw, X } from 'lucide-react';

/** The lines to say, from a recording script's "## Script" section. Cues in [brackets] stay, shown quietly. */
export function scriptLines(markdown: string): string[] {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => /^## Script\s*$/i.test(line));
  if (start < 0) return [];
  const next = lines.findIndex((line, i) => i > start && line.startsWith('## '));
  return lines
    .slice(start + 1, next < 0 ? undefined : next)
    .map((line) => line.replace(/^#+\s*/, '').replace(/^[-*>]\s+/, '').replace(/\*\*|__|\*/g, '').trim())
    .filter(Boolean);
}

const SPEEDS = [20, 30, 40, 55, 70, 90, 115]; // pixels per second

export function Teleprompter({ lines, onClose }: { lines: string[]; onClose: () => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(2);
  const [mirrored, setMirrored] = useState(false);
  const [size, setSize] = useState(44);

  // Scroll by time, not by frame, so the pace holds on any display.
  useEffect(() => {
    if (!running) return;
    let last = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const el = scroller.current;
      if (el) {
        el.scrollTop += ((now - last) / 1000) * SPEEDS[speed]!;
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) setRunning(false);
      }
      last = now;
      frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [running, speed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
      else if (e.key === ' ') setRunning((r) => !r);
      else if (e.key === 'ArrowUp') setSpeed((s) => Math.min(SPEEDS.length - 1, s + 1));
      else if (e.key === 'ArrowDown') setSpeed((s) => Math.max(0, s - 1));
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="teleprompter" role="dialog" aria-label="Teleprompter">
      <div className="lines" ref={scroller} style={{ fontSize: size, transform: mirrored ? 'scaleX(-1)' : undefined }} onClick={() => setRunning((r) => !r)}>
        <div className="pad" />
        {lines.map((line, i) =>
          /^\[.*\]$/.test(line) ? <p key={i} className="cue">{line}</p> : <p key={i}>{line}</p>,
        )}
        <div className="pad" />
      </div>
      <i className="guide" aria-hidden />
      <footer>
        <button type="button" className="primary round" aria-label={running ? 'Pause' : 'Start'} onClick={() => setRunning(!running)}>
          {running ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button type="button" className="ghost" title="Back to the top" aria-label="Back to the top" onClick={() => (setRunning(false), scroller.current?.scrollTo({ top: 0 }))}>
          <RotateCcw size={14} />
        </button>
        <span className="group" title="Speed (↑ ↓)">
          <button type="button" className="ghost" aria-label="Slower" onClick={() => setSpeed(Math.max(0, speed - 1))}><Minus size={14} /></button>
          Speed {speed + 1}
          <button type="button" className="ghost" aria-label="Faster" onClick={() => setSpeed(Math.min(SPEEDS.length - 1, speed + 1))}><Plus size={14} /></button>
        </span>
        <span className="group" title="Text size">
          <button type="button" className="ghost" aria-label="Smaller text" onClick={() => setSize(Math.max(24, size - 6))}><Minus size={14} /></button>
          Size
          <button type="button" className="ghost" aria-label="Larger text" onClick={() => setSize(Math.min(96, size + 6))}><Plus size={14} /></button>
        </span>
        <button type="button" className={mirrored ? 'active' : 'ghost'} title="Mirror, for teleprompter glass" aria-label="Mirror" onClick={() => setMirrored(!mirrored)}>
          <FlipHorizontal2 size={14} />
        </button>
        <span className="spacer" />
        <span className="hint">Space starts and pauses · Esc closes</span>
        <button type="button" className="ghost" aria-label="Close teleprompter" onClick={onClose}><X size={16} /></button>
      </footer>
    </div>
  );
}
