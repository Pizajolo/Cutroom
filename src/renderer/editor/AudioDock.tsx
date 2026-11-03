import { useEffect, useState } from 'react';
import { audioGenerateRequestSchema, type AudioVoice } from '@shared/schema/audio';
import { api } from '../lib/api';
import { useAccounts } from '../lib/useAccounts';
import { useJobs } from '../lib/resources';
import { errorMessage, useNavigation } from '../state/navigation';
import { Notice } from '../components/Notice';
import { JobProgress } from '../components/Jobs';
import { previewClock } from './preview/store';
import { openSettings } from '../pages/WorkspaceSettings';
export function AudioDock() {
  const { data: accounts, error: accountError } = useAccounts();
  const connected = accounts?.some((a) => a.provider === 'elevenlabs' && a.status === 'connected');
  const project = useNavigation((s) => s.project);
  const { data: jobs } = useJobs();
  const [kind, setKind] = useState<'tts' | 'sfx' | 'music'>('tts');
  const [voices, setVoices] = useState<AudioVoice[]>([]);
  const [voiceId, setVoiceId] = useState('');
  const [text, setText] = useState('');
  const [model, setModel] = useState('eleven_multilingual_v2');
  const [duration, setDuration] = useState(10);
  const [estimate, setEstimate] = useState<{ key: string; credits: number | null } | null>(null);
  const [error, setError] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [insert, setInsert] = useState(true);
  const job = jobs?.find((j) => j.id === jobId);
  const estimateKey = JSON.stringify([kind, text, duration]);
  const credits = estimate?.key === estimateKey ? estimate.credits : null;
  useEffect(() => {
    if (!connected) return;
    let active = true;
    void api.invoke('audio.voices', {}).then((value) => { if (active) { setVoices(value); setVoiceId(value[0]?.id ?? ''); } }).catch((r: unknown) => { if (active) setError(errorMessage(r)); });
    return () => { active = false; };
  }, [connected]);
  useEffect(() => {
    if (!connected) return;
    let active = true;
    const timer = setTimeout(() => { void api.invoke('audio.estimate', { kind, text, ...(kind !== 'tts' ? { durationSec: duration } : {}) }).then((value) => { if (active) setEstimate({ key: estimateKey, credits: value.credits }); }).catch(() => { if (active) setEstimate({ key: estimateKey, credits: null }); }); }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [connected, kind, text, duration, estimateKey]);
  const generate = async () => {
    if (busy || !project) return;
    const capturedProject = project;
    setBusy(true); setError('');
    try {
      // Main owns placement so completion still works after closing this dock.
      const placement = insert ? { time: previewClock.getSnapshot().time, track: kind === 'tts' ? 'voiceover' as const : kind === 'sfx' ? 'sfx' as const : 'music' as const } : undefined;
      const request = audioGenerateRequestSchema.parse(kind === 'tts' ? { kind, text, voiceId, model, ...(placement ? { placement } : {}) } : { kind, text, durationSec: duration, ...(placement ? { placement } : {}) });
      const result = await api.invoke('audio.generate', request);
      if (useNavigation.getState().project === capturedProject) setJobId(result.jobId);
    } catch (r) { if (useNavigation.getState().project === capturedProject) setError(errorMessage(r)); } finally { setBusy(false); }
  };
  if (!connected) return <div className="dock-placeholder"><h3>Connect ElevenLabs</h3><p>{accountError ?? 'Use your saved ElevenLabs account for voiceover, effects and music.'}</p><button className="button" onClick={() => openSettings('Accounts')}>Connect ElevenLabs</button></div>;
  return <div className="audio-dock settings-form"><label className="form-field">Section<select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}><option value="tts">Voiceover</option><option value="sfx">Effects</option><option value="music">Music</option></select></label>{kind === 'tts' && <><label className="form-field">Voice<select value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>{voices.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label><label className="form-field">Model<select value={model} onChange={(e) => setModel(e.target.value)}><option value="eleven_multilingual_v2">Multilingual v2</option><option value="eleven_flash_v2_5">Flash v2.5</option></select></label><label className="form-field">Speed<input value="1× · Original speed" readOnly /></label></>}<label className="form-field">{kind === 'tts' ? 'Script' : 'Description'}<textarea rows={6} maxLength={50000} value={text} onChange={(e) => setText(e.target.value)} /></label>{kind !== 'tts' && <label className="form-field">Duration (seconds)<input type="number" min={1} max={600} value={duration} onChange={(e) => setDuration(Number(e.target.value))} /></label>}<label className="check-row"><input type="checkbox" checked={insert} onChange={(e) => setInsert(e.target.checked)} />Insert at playhead</label><p className="field-note">Text is sent to ElevenLabs. Generated audio is saved in audio/; original media stays unchanged.</p><p>{credits === null ? 'Balance unavailable' : `Estimated ${credits.toLocaleString()} credits`}</p>{!project && <p className="field-note">Open a project before generating audio.</p>}<button className="button primary" disabled={!project || busy || !text.trim() || kind === 'tts' && !voiceId || kind !== 'tts' && (!Number.isFinite(duration) || duration < 1 || duration > 600) || job?.status === 'running' || job?.status === 'queued'} onClick={() => { void generate(); }}>{busy ? 'Starting…' : 'Generate'}</button>{error && <Notice danger>{error}</Notice>}{job && <JobProgress key={job.id} job={job} />}</div>;
}
