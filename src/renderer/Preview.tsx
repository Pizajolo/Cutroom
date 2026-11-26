import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import { Check, FileText, Flag, Pause, Play, ScrollText } from 'lucide-react';
import { cutFiles, timelineLength } from '../shared/types';
import type { Mark, MediaFile, Script, Timeline } from '../shared/types';
import type { PreviewState } from './App';
import { Markdown } from './Markdown';
import { Teleprompter, scriptLines } from './Teleprompter';
import { clock, useVideoTime } from './lib';

interface Props {
  video: RefObject<HTMLVideoElement | null>;
  /** The chat whose edit is shown. */
  cut: string;
  timeline: Timeline | null;
  preview: PreviewState;
  media: MediaFile[];
  marks: Mark[];
  onMark: (mark: Mark) => void;
  script: Script;
  /** `recording`: the script is for footage still to be recorded (it has a "## Script" of words to say). */
  onApprove: (recording: boolean) => void;
  /** The user picked another opening from the storyboard's hook options. */
  onHook: (n: number, hook: string) => void;
  onApproveSpokenCut: () => void;
}

/** The storyboard. Nothing is cut until the user approves it; the opening can be swapped for another hook option. */
function ScriptPage({ script, onApprove, onHook }: Pick<Props, 'script' | 'onApprove' | 'onHook'>) {
  // A recording script (written before there is footage) has the words to say under "## Script": it can be read
  // off a teleprompter, and approving it means "I'll go and record this", not "cut the video".
  const spoken = scriptLines(script.text);
  const recording = spoken.length > 0;
  const [prompting, setPrompting] = useState(false);
  // "## Hooks" holds a numbered list of openings; the one in use is marked "(in script)".
  const lines = script.text.split('\n');
  const start = lines.findIndex((line) => /^## Hooks\s*$/.test(line));
  const next = lines.findIndex((line, i) => i > start && line.startsWith('## '));
  const end = start < 0 ? 0 : next < 0 ? lines.length : next;
  const before = lines.slice(0, Math.max(start, 0)).join('\n');
  const after = lines.slice(end).join('\n');
  const options = lines.slice(start + 1, end).flatMap((line) => {
    const item = /^\d+\.\s+(.*)$/.exec(line)?.[1];
    return item ? [{ text: item.replace(/\*\*\(in script\)\*\*|\(in script\)/i, '').trim(), chosen: /\(in script\)/i.test(item) }] : [];
  });
  return (
    <div className="script">
      <article>
        <Markdown text={before} />
        {options.length > 0 && (
          <>
            <h3>Hooks</h3>
            <div className="hooks">
              {options.map((option, n) => (
                <button key={n} className={option.chosen ? 'selected' : ''} disabled={option.chosen || !script.pending} title={option.chosen ? 'The opening in the storyboard' : 'Use this opening instead'} onClick={() => onHook(n + 1, option.text)}>
                  <Markdown text={option.text} />
                  {option.chosen && <span className="tag ok">In storyboard</span>}
                </button>
              ))}
            </div>
          </>
        )}
        <Markdown text={after} />
      </article>
      {(script.pending || recording) && (
        <footer>
          {recording && (
            <button title="Read the script off the screen while you record" onClick={() => setPrompting(true)}>
              <ScrollText size={16} /> Teleprompter
            </button>
          )}
          {script.pending && (
            <>
              <span className="hint">Ask for changes in the chat, or</span>
              <button className="primary" onClick={() => onApprove(recording)}>
                <Check size={16} /> {recording ? 'Approve script' : <>Approve &amp; create video</>}
              </button>
            </>
          )}
        </footer>
      )}
      {prompting && <Teleprompter lines={spoken} onClose={() => setPrompting(false)} />}
    </div>
  );
}

/** The edit as the user sees it, with the controls for pointing at what they like or dislike. */
export function Preview({ video, cut, timeline, preview, media, marks, onMark, script, onApprove, onHook, onApproveSpokenCut }: Props) {
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
    el.src = `media://project/${cutFiles(cut).preview}?v=${preview.version}`;
    el.currentTime = at;
  }, [preview.version, video, cut]);

  const toggle = (): void => void (video.current?.paused ? video.current.play() : video.current?.pause());
  const markRange = (): void => {
    if (rangeStart === null) return setRangeStart(time);
    onMark({ start: Math.min(rangeStart, time), end: Math.max(rangeStart, time) });
    setRangeStart(null);
  };

  if (!preview.version && script.text) {
    return <section className="preview"><ScriptPage script={script} onApprove={onApprove} onHook={onHook} /></section>;
  }
  if (!preview.version) {
    return (
      <section className="preview empty">
        {preview.rendering ? (
          <p>
            {preview.stage === 'proxies' ? 'Preparing your footage for fast previews (once per file)' : 'Rendering the first preview'}…
            {preview.progress !== undefined && ` ${Math.round(preview.progress * 100)}%`}
          </p>
        ) : <p>Your edit will appear here. Tell Claude what to make.</p>}
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
        {showScript && <ScriptPage script={script} onApprove={onApprove} onHook={onHook} />}
        {(preview.rendering || preview.error) && (
          <span className={preview.error ? 'badge error' : 'badge'} title={preview.error}>
            {preview.error
              ? 'Preview failed'
              : `${preview.stage === 'proxies' ? 'Preparing footage' : 'Updating'}…${preview.progress !== undefined ? ` ${Math.round(preview.progress * 100)}%` : ''}`}
            {!preview.error && preview.progress !== undefined && <i className="progress" style={{ width: `${preview.progress * 100}%` }} />}
          </span>
        )}
      </div>
      {script.spokenCut && (
        <div className="approve">
          <span>Spoken cut: only the speech so far. Ask for changes in the chat, or</span>
          <button className="primary" onClick={onApproveSpokenCut}><Check size={16} /> Approve spoken cut</button>
        </div>
      )}
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
            <FileText size={14} /> Storyboard
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
