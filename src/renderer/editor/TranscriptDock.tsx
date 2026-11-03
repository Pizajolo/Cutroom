import { useEffect, useState } from 'react';
import type { Transcript } from '@shared/schema/transcripts';
import { api } from '../lib/api';
import { useSettings, useJobs } from '../lib/resources';
import { useModels } from '../lib/useTools';
import { useAccounts } from '../lib/useAccounts';
import { errorMessage } from '../state/navigation';
import { Notice } from '../components/Notice';
import { JobProgress } from '../components/Jobs';
import { previewClock } from './preview/store';
import { useEditor } from './store';
import { useSelection } from './selection/store';
export function TranscriptDock() {
  const media = useEditor((s) => s.media);
  const timeline = useEditor((s) => s.timeline);
  const selection = useSelection((s) => s.elements);
  const { data: settings } = useSettings();
  const { data: models } = useModels();
  const { data: accounts } = useAccounts();
  const { data: jobs } = useJobs();
  const [source, setSource] = useState('');
  const [engine, setEngine] = useState<'whisper' | 'scribe' | null>(null);
  const [model, setModel] = useState('');
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [generating, setGenerating] = useState(false);
  const selectedClip = timeline?.doc.tracks.flatMap((t) => t.items).find((i) => i.type === 'clip' && selection.some((s) => s.itemId === i.id));
  const rel = source || (selectedClip?.type === 'clip' ? selectedClip.src : '') || media.find((f) => ['video', 'audio'].includes(f.kind))?.rel || '';
  const chosenEngine = engine ?? settings?.voiceInput.engine ?? 'whisper';
  const chosenModel = model || settings?.voiceInput.model || '';
  const job = jobs?.find((j) => j.id === jobId);
  useEffect(() => {
    if (!rel) return;
    let active = true;
    queueMicrotask(() => { if (active) { setLoading(true); setError(''); setTranscript(null); } });
    void api.invoke('transcripts.get', { rel }).then((value) => { if (active) setTranscript(value); }).catch((r: unknown) => { if (active) setError(errorMessage(r)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [rel, job?.status]);
  const generate = async () => {
    if (!rel || generating) return; setGenerating(true); setError('');
    try { setJobId((await api.invoke('transcripts.start', { rel, engine: chosenEngine, ...(chosenEngine === 'whisper' && chosenModel ? { model: chosenModel } : {}) })).jobId); }
    catch (r) { setError(errorMessage(r)); } finally { setGenerating(false); }
  };
  const scribeConnected = accounts?.some((a) => a.provider === 'elevenlabs' && a.status === 'connected');
  return <div className="transcript-dock settings-form"><label className="form-field">Source<select value={rel} onChange={(e) => setSource(e.target.value)}><option value="" disabled>Choose media</option>{media.filter((f) => ['video', 'audio'].includes(f.kind)).map((f) => <option key={f.rel} value={f.rel}>{f.name}</option>)}</select></label><label className="form-field">Engine<select value={chosenEngine} onChange={(e) => setEngine(e.target.value as 'whisper' | 'scribe')}><option value="whisper">Local Whisper</option><option value="scribe" disabled={!scribeConnected}>ElevenLabs Scribe · External processing</option></select></label>{chosenEngine === 'whisper' && <label className="form-field">Model<select value={chosenModel} onChange={(e) => setModel(e.target.value)}>{!models?.some((m) => m.name === chosenModel && m.status === 'installed') && <option value={chosenModel}>{chosenModel || 'Choose an installed model'} · Not installed</option>}{models?.filter((m) => m.status === 'installed').map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}</select></label>}{chosenEngine === 'scribe' && <p className="field-note">Audio is sent to ElevenLabs for transcription.</p>}<button className="button primary" disabled={!rel || generating || job?.status === 'running' || job?.status === 'queued'} onClick={() => { void generate(); }}>{generating ? 'Starting…' : transcript ? 'Regenerate' : 'Generate'}</button>{job && <JobProgress job={job} />}{error && <Notice danger>{error}</Notice>}{loading ? <p role="status">Loading transcript…</p> : !transcript ? <p className="field-note">Transcribe this clip to edit captions and find a moment.</p> : <><label className="form-field">Search transcript<input type="search" value={query} onChange={(e) => setQuery(e.target.value)} /></label><p className="transcript-words">{transcript.words.map((word, index) => <button key={index} className={query && word.text.toLowerCase().includes(query.toLowerCase()) ? 'word-match' : ''} onClick={() => { const clip = selectedClip?.type === 'clip' && selectedClip.src === rel ? selectedClip : null; previewClock.seek(clip ? clip.start + (word.start - clip.in) / clip.speed : word.start); }}>{word.text} </button>)}</p></>}<button className="button" disabled={selectedClip?.type !== 'clip'} aria-describedby="captions-selection-note" onClick={() => { if (selectedClip?.type === 'clip') void api.invoke('captions.generate', { clipItemId: selectedClip.id }).then(() => useEditor.getState().reload()).catch((r: unknown) => setError(errorMessage(r))); }}>Generate captions</button>{selectedClip?.type !== 'clip' && <p id="captions-selection-note" className="field-note">Select a timeline clip to generate captions for its trimmed portion.</p>}</div>;
}
