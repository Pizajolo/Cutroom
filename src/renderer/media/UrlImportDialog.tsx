import { useRef, useState } from 'react';
import { importUrlSchema, type UrlMetadata } from '@shared/schema/urlImport';
import type { ImportDestination } from '@shared/schema/media';
import { IpcFailure } from '@shared/ipc';
import { api } from '../lib/api';
import { useJobs } from '../lib/resources';
import { formatBytes, formatDuration } from '../lib/time';
import { errorMessage, useNavigation } from '../state/navigation';
import { Dialog } from '../components/Dialog';
import { Notice } from '../components/Notice';
import { JobProgress } from '../components/Jobs';
const errors: Record<string, string> = { unsupported_site: "This site isn't supported. Try a direct video URL from a supported source.", network: 'The connection was interrupted. Check your connection and retry.', disk_full: 'There is not enough disk space. Free some space and retry.', format_unavailable: 'That format is no longer available. Fetch formats again and choose another quality.' };
export function UrlImportDialog({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState('');
  const [destination, setDestination] = useState<ImportDestination>('references');
  const [metadata, setMetadata] = useState<UrlMetadata | null>(null);
  const [formatId, setFormatId] = useState('');
  const [rights, setRights] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [starting, setStarting] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const { data: jobs } = useJobs();
  const job = jobs?.find((j) => j.id === jobId);
  const validate = () => { const valid = importUrlSchema.safeParse(url).success; if (!valid) setError('Enter an HTTP(S) URL without credentials.'); return valid; };
  const fetch = async () => {
    if (!validate()) return;
    const id = ++generation.current; setFetching(true); setError(''); setMetadata(null);
    try { const result = await api.invoke('urlImport.fetch', { url }); if (id === generation.current) { setMetadata(result); setFormatId(result.formats[0]?.id ?? ''); } }
    catch (r) { if (id === generation.current) setError(r instanceof IpcFailure ? errors[String(r.details?.code ?? r.code)] ?? r.message : errorMessage(r)); }
    finally { if (id === generation.current) setFetching(false); }
  };
  const download = async () => {
    if (!rights || !metadata || !validate() || starting) return;
    setStarting(true); setError('');
    try { setJobId((await api.invoke('urlImport.download', { url, formatId, destination, rightsConfirmed: true })).jobId); }
    catch (r) { setError(r instanceof IpcFailure ? errors[String(r.details?.code ?? r.code)] ?? r.message : errorMessage(r)); }
    finally { setStarting(false); }
  };
  return <Dialog title="Import from URL" wide onClose={() => { generation.current++; onClose(); }} footer={jobId ? <><button className="button" onClick={onClose}>{job?.status === 'done' ? 'Done' : 'Run in background'}</button>{job?.status === 'done' && <button className="button primary" onClick={() => { useNavigation.setState({ destination: 'project', dock: 'Media' }); onClose(); }}>Show in Media</button>}</> : <><button className="button" onClick={() => { if (fetching) { generation.current++; setFetching(false); } else onClose(); }}>Cancel</button><button className="button primary" disabled={fetching || starting || (!!metadata && (!rights || !formatId))} onClick={() => { void (metadata ? download() : fetch()); }}>{fetching ? 'Fetching formats…' : starting ? 'Starting…' : metadata ? 'Download' : error ? 'Retry' : 'Fetch formats'}</button></>}>
    <div className="settings-form"><label className="form-field">URL<input value={url} type="url" disabled={!!jobId || fetching} onBlur={validate} onChange={(e) => { setUrl(e.target.value); setMetadata(null); setRights(false); setError(''); }} /></label><p className="field-note">The URL is sent to the source site to fetch formats and download your selection.</p><label className="form-field">Destination<select disabled={!!jobId} value={destination} onChange={(e) => setDestination(e.target.value as ImportDestination)}><option value="references">References (references/)</option><option value="raw">Footage (raw/)</option><option value="assets">Assets (assets/)</option></select></label>{error && <Notice danger>{error}</Notice>}{metadata && <><div className="url-metadata">{metadata.thumbnailUrl && <img src={metadata.thumbnailUrl} alt="" referrerPolicy="no-referrer" />}<div><h3>{metadata.title}</h3><p>{metadata.uploader} · {formatDuration(metadata.durationSec)}</p></div></div><fieldset disabled={!!jobId}><legend>Quality</legend>{metadata.formats.map((f, index) => <label className="quality-row" key={f.id}><input type="radio" name="url-format" checked={formatId === f.id} onChange={() => setFormatId(f.id)} /><span>{index === 0 ? 'Best (recommended) · ' : ''}{f.label}</span><span>{f.ext} · {f.fps ? `${f.fps} fps` : ''}</span><span>{f.approxBytes === undefined ? 'Size unknown' : formatBytes(f.approxBytes)}</span></label>)}</fieldset><label className="check-row"><input type="checkbox" checked={rights} disabled={!!jobId} onChange={(e) => setRights(e.target.checked)} />I own this content or have permission to use it.</label></>}{job && <JobProgress job={job} />}</div>
  </Dialog>;
}
