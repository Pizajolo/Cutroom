import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import { Check, FileText, Flag, Pause, Play } from 'lucide-react';
import { timelineLength } from '../shared/types';
import type { Mark, MediaFile, Script, Timeline } from '../shared/types';
import type { PreviewState } from './App';
import { Markdown } from './Markdown';
import { clock, useVideoTime } from './lib';

interface Props {
  video: RefObject<HTMLVideoElement | null>;
  timeline: Timeline | null;
  preview: PreviewState;
  media: MediaFile[];
  marks: Mark[];
  onMark: (mark: Mark) => void;
  script: Script;
  onApprove: () => void;
}

/** The plan for the video. Nothing is cut until the user approves it. */
function ScriptPage({ script, onApprove }: Pick<Props, 'script' | 'onApprove'>) {
  return (
    <div className="script">
      <article><Markdown text={script.text} /></article>
      {script.pending && (
        <footer>
          <span className="hint">Ask for changes in the chat, or</span>
          <button className="primary" onClick={onApprove}><Check size={16} /> Approve &amp; create video</button>
        </footer>
      )}
    </div>
  );
}

/** The edit as the user sees it, with the controls for pointing at what they like or dislike. */
export function Preview({ video, timeline, preview, media, marks, onMark, script, onApprove }: Props) {
  const time = useVideoTime(video);
  const [playing, setPlaying] = useState(false);
  const [rangeStart, setRangeStart] = useState<number | null>(null);
  const [showScript, setShowScript] = useState(false);
  const length = timeline ? timelineLength(timeline) : 0;

  // A new or revised script comes to the front; once the edit catches up, the video does.
  useEffect(() => setShowScript(script.pending), [script.pending]);

  // Keep the playhead where it was when a new preview render replaces the video.
  useEffect(() => {
    const el = video.current;
    if (!el || !preview.version) return;
    const at = el.currentTime;
    el.src = `media://project/.cutroom/preview.mp4?v=${preview.version}`;
    el.currentTime = at;
  }, [preview.version, video]);

  const toggle = (): void => void (video.current?.paused ? video.current.play() : video.current?.pause());
  const markRange = (): void => {
    if (rangeStart === null) return setRangeStart(time);
    onMark({ start: Math.min(rangeStart, time), end: Math.max(rangeStart, time) });
    setRangeStart(null);
  };

  if (!preview.version && script.text) {
    return <section className="preview"><ScriptPage script={script} onApprove={onApprove} /></section>;
  }
  if (!preview.version) {
    return (
      <section className="preview empty">
        {preview.rendering ? <p>Rendering the first preview…</p> : <p>Your edit will appear here. Tell Claude what to make.</p>}
        {preview.error && <p className="note error">{preview.error}</p>}
        <ul>
          {media.map((file) => (
            <li key={file.path}>{file.path}</li>
          ))}
        </ul>
        <p className="hint">Drop footage, logos or music anywhere to add them.</p>
      </section>
    );
  }

  const percent = (t: number): string => `${(t / Math.max(length, 0.01)) * 100}%`;
  return (
    <section className="preview">
      <div className="stage">
        <video ref={video} onClick={toggle} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
        {showScript && <ScriptPage script={script} onApprove={onApprove} />}
        {(preview.rendering || preview.error) && (
          <span className={preview.error ? 'badge error' : 'badge'} title={preview.error}>
            {preview.error ? 'Preview failed' : 'Updating…'}
          </span>
        )}
      </div>
      <div className="scrub">
        <input
          type="range" min={0} max={length} step={0.01} value={Math.min(time, length)} aria-label="Position"
          onChange={(e) => video.current && (video.current.currentTime = Number(e.target.value))}
        />
        {marks.map((mark, i) => (
          <i key={i} style={{ left: percent(mark.start), width: mark.end ? percent(mark.end - mark.start) : undefined }} />
        ))}
        {rangeStart !== null && <i className="pending" style={{ left: percent(Math.min(rangeStart, time)), width: percent(Math.abs(time - rangeStart)) }} />}
      </div>
      <div className="transport">
        <button className="ghost" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <span className="time">{clock(time)} / {clock(length)}</span>
        <span className="spacer" />
        {script.text && (
          <button className={showScript ? 'active' : ''} title="The plan this video follows" onClick={() => setShowScript(!showScript)}>
            <FileText size={14} /> Script
          </button>
        )}
        <button title="Point Claude at this exact frame" onClick={() => onMark({ start: time })}>
          <Flag size={14} /> Mark frame
        </button>
        <button className={rangeStart !== null ? 'active' : ''} title="Point Claude at a section: click at its start, then at its end" onClick={markRange}>
          <Flag size={14} /> {rangeStart === null ? 'Mark section' : `End section (from ${clock(rangeStart)})`}
        </button>
      </div>
    </section>
  );
}
