import { useState } from 'react';
import { Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { formatTimecode, parseTimecode } from '../../lib/time';
import { previewClock, useClock } from './store';

function SeekField() {
  const time = useClock((state) => state.time);
  const fps = useClock((state) => state.fps);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const commit = () => {
    if (draft === null) return;
    const value = parseTimecode(draft, fps);
    if (value === null) { setError(true); return; }
    previewClock.seek(value); setDraft(null); setError(false);
  };
  return <div className="seek-field"><input className="timecode" aria-label="Current time (minutes:seconds.frames)" aria-invalid={error}
    title={`${time.toFixed(3)} seconds; non-drop frame timecode`} value={draft ?? formatTimecode(time, fps)}
    onChange={(event) => { setDraft(event.target.value); setError(false); }} onBlur={commit}
    onKeyDown={(event) => {
      if (event.key === 'Enter') { event.preventDefault(); commit(); }
      if (event.key === 'Escape') { event.preventDefault(); setDraft(null); setError(false); }
    }} />{error && <span className="field-error">Use m:ss.ff</span>}</div>;
}

export function Transport() {
  const playing = useClock((state) => state.playing);
  const duration = useClock((state) => state.duration);
  const fps = useClock((state) => state.fps);
  const rate = useClock((state) => state.rate);
  return <div className="transport" aria-label="Playback controls">
    <div className="transport-buttons">
      <button type="button" className="icon-button" aria-label="Go to start" disabled={!duration} onClick={() => previewClock.seek(0)}><SkipBack size={16} /></button>
      <button type="button" className="icon-button play-button" aria-label={playing ? 'Pause' : 'Play'} title="Play / pause (Space)" disabled={!duration} onClick={() => previewClock.toggle()}>{playing ? <Pause size={18} /> : <Play size={18} />}</button>
      <button type="button" className="icon-button" aria-label="Go to end" disabled={!duration} onClick={() => previewClock.seek(duration)}><SkipForward size={16} /></button>
    </div>
    <SeekField /><span className="quiet">/</span><span className="timecode">{formatTimecode(duration, fps)}</span>
    {playing && rate !== 1 && <span className="playback-rate">{rate}×</span>}
  </div>;
}

export function ScrubBar() {
  const time = useClock((state) => state.time);
  const duration = useClock((state) => state.duration);
  const fps = useClock((state) => state.fps);
  return <input className="scrub-bar" type="range" aria-label="Seek preview" min={0} max={duration || 1} step={1 / fps} value={time} disabled={!duration}
    aria-valuetext={`${time.toFixed(2)} seconds`} onChange={(event) => previewClock.seek(Number(event.target.value))} />;
}
