import { useEffect, useState } from 'react';
import type { ExportPreset, ExportPreflight } from '@shared/schema/export';
import { api } from '../lib/api';
import { useJobs } from '../lib/resources';
import { errorMessage, useNavigation } from '../state/navigation';
import { Dialog } from '../components/Dialog';
import { Notice } from '../components/Notice';
import { JobProgress } from '../components/Jobs';

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const [presets, setPresets] = useState<ExportPreset[]>([]);
  const [presetId, setPresetId] = useState('');
  const [preflight, setPreflight] = useState<ExportPreflight | null>(null);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [check, setCheck] = useState(0);
  const { data: jobs } = useJobs();
  const project = useNavigation((s) => s.project);
  const job = jobs?.find((j) => j.id === jobId);
  useEffect(() => { let active = true; void Promise.all([api.invoke('export.presets', {}), api.invoke('settings.get', {})]).then(([list, settings]) => { if (active) { setPresets(list); setPresetId(list.find((p) => p.id === settings.renderPresets.defaultId)?.id ?? list[0]?.id ?? ''); } }).catch((r: unknown) => { if (active) setError(errorMessage(r)); }); return () => { active = false; }; }, []);
  useEffect(() => { if (!presetId) return; let active = true; void api.invoke('export.preflight', { presetId }).then((value) => { if (active) setPreflight(value); }).catch((r: unknown) => { if (active) setError(errorMessage(r)); }); return () => { active = false; }; }, [presetId, check]);
  const preset = presets.find((p) => p.id === presetId);
  const start = async () => {
    if (busy || !preflight?.canExport || preflight.blockers.length || preflight.unsupportedItems.length && !ack) return;
    setBusy(true); setError('');
    try { setJobId((await api.invoke('export.start', { presetId, acknowledgeUnsupported: ack })).jobId); }
    catch (r) { setError(errorMessage(r)); } finally { setBusy(false); }
  };
  const result = job?.result && typeof job.result === 'object' ? job.result as Record<string, unknown> : {};
  const rel = typeof result.rel === 'string' ? result.rel : null;
  const action = (channel: 'shell.openInProject' | 'shell.revealInProject', value: string) => { void api.invoke(channel, { rel: value }).catch((r: unknown) => setError(errorMessage(r))); };
  return <Dialog title={job?.status === 'done' ? 'Your video is ready' : jobId ? 'Rendering video' : 'Export video'} onClose={onClose} wide footer={jobId ? <><button className="button" onClick={onClose}>{job && ['done', 'failed', 'cancelled'].includes(job.status) ? 'Done' : 'Run in background'}</button></> : <><button className="button" onClick={onClose}>Cancel</button><button className="button primary" disabled={busy || !preflight?.canExport || !!preflight.blockers.length || (!!preflight.unsupportedItems.length && !ack)} onClick={() => { void start(); }}>{busy ? 'Starting…' : 'Export video'}</button></>}>
    {error && <Notice danger>{error}</Notice>}
    {jobId ? !job ? <p role="status">Queued…</p> : <>{['queued', 'running'].includes(job.status) && <ol aria-label="Render stages">{['Preparing compositions', 'Analysing audio', 'Encoding', 'Finishing'].map((phase) => <li key={phase} aria-current={phase.toLowerCase() === job.phase.toLowerCase() ? 'step' : undefined}>{phase}</li>)}</ol>}<JobProgress key={job.id} job={job} cancelLabel="Cancel render" />{job.status === 'done' && <><p className="literal-path">{rel ?? 'Export complete'}</p>{typeof result.durationSec === 'number' && <p>{result.durationSec.toFixed(1)} seconds</p>}<div className="form-row"><button className="button primary" disabled={!rel} onClick={() => rel && action('shell.openInProject', rel)}>Play video</button><button className="button" disabled={!rel} onClick={() => rel && action('shell.revealInProject', rel)}>Reveal in Finder</button></div></>}{job.status === 'cancelled' && <p>Export cancelled. No new version was saved.</p>}{job.status === 'failed' && <p>The render couldn't be completed. Your edit is safe. Check the details and try again.</p>}{['failed', 'cancelled'].includes(job.status) && <div className="form-row"><button className="button primary" onClick={() => { setJobId(null); setPreflight(null); setAck(false); setError(''); setCheck((value) => value + 1); }}>{job.status === 'failed' ? 'Retry' : 'Export again'}</button><button className="button" onClick={() => action('shell.revealInProject', job.logPath)}>View details</button></div>}</> : <div className="settings-form"><label className="form-field">Preset<select value={presetId} onChange={(e) => { setPreflight(null); setAck(false); setError(''); setPresetId(e.target.value); }}>{presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>{preset && <dl className="property-list"><div><dt>Size / fps</dt><dd>{preset.size === 'project' ? `${project?.project.format.width} × ${project?.project.format.height}` : `${preset.size.width} × ${preset.size.height}`} · {preset.fps === 'project' ? project?.project.format.fps : preset.fps} fps</dd></div><div><dt>Video</dt><dd>{preset.vcodec} · {preset.container.toUpperCase()}</dd></div><div><dt>Audio</dt><dd>−14 LUFS / −1 dBTP</dd></div><div><dt>Range</dt><dd>Entire timeline</dd></div><div><dt>Destination</dt><dd>Next available version in final/</dd></div></dl>}{!preflight && <p role="status">Checking export…</p>}{preflight?.blockers.map((b) => <Notice danger key={b}>{b}</Notice>)}{!!preflight?.unsupportedItems.length && <section><h3>These items can't be rendered</h3><ul>{preflight.unsupportedItems.map((i) => <li key={i.itemId}>{i.name} ({i.type})</li>)}</ul><button className="button" onClick={onClose}>Return to editor</button><label className="check-row"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />Export without these items</label></section>}</div>}
  </Dialog>;
}
