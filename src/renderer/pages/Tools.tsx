import { useEffect, useState } from 'react';
import { CircleAlert, CircleCheck, Download, RefreshCw, ShieldAlert } from 'lucide-react';
import type { InvokeRes } from '@shared/ipc';
import { api } from '../lib/api';
import { Notice } from '../components/Notice';

const STATUS_LABEL = { ok: 'OK', missing: 'Missing', checksum_mismatch: 'Checksum mismatch' } as const;
export function Tools() {
  const [tools, setTools] = useState<InvokeRes<'tools.list'> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    let eventVersion = 0;
    const unsubscribe = api.on('tools.changed', (value) => { eventVersion++; if (active) { setTools(value); setError(null); } });
    const version = eventVersion;
    void api.invoke('tools.list', {}).then((value) => { if (active && eventVersion === version) { setTools(value); setError(null); } }).catch((reason: unknown) => { if (active && eventVersion === version) setError(reason instanceof Error ? reason.message : 'Bundled tools could not be checked.'); });
    return () => { active = false; unsubscribe(); };
  }, [refresh]);
  return <div className="tools-settings">
    <div className="section-heading"><h2>Bundled tools</h2><button type="button" className="button" onClick={() => setRefresh((value) => value + 1)}><RefreshCw size={14} />Check again</button></div>
    <p className="settings-intro">Tools ship with Cutroom. Checksums are verified before use; missing or modified tools cannot run.</p>
    {error && <Notice danger>{error}</Notice>}
    {!tools && !error ? <p role="status">Checking tools…</p> : tools && <div className="table-scroll"><table className="tools-table"><thead><tr><th scope="col">Tool</th><th scope="col">Version</th><th scope="col">Source</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
      <tbody>{tools.map((tool) => {
        const Icon = tool.status === 'ok' ? CircleCheck : tool.status === 'checksum_mismatch' ? ShieldAlert : CircleAlert;
        return <tr key={tool.name}><th scope="row">{tool.name}</th><td>{tool.version}</td><td>{tool.source === 'bundled' ? 'Bundled' : 'Updated'}</td><td><span className={`tool-status tool-${tool.status}`}><Icon size={14} />{STATUS_LABEL[tool.status]}</span></td><td>{tool.name === 'yt-dlp' && <button type="button" className="button" disabled aria-describedby="tools-update-note">Update</button>}</td></tr>;
      })}</tbody></table></div>}
    <p className="field-note" id="tools-update-note">Automatic updates and the last update-check time are not available in this build.</p>
    <section className="settings-subsection" aria-labelledby="whisper-models-title"><h2 id="whisper-models-title">Whisper models</h2><p className="settings-intro">Model installation status isn't connected. No model is reported as installed until it has been verified.</p>
      <div className="model-list">{['base', 'small', 'medium', 'large-v3-turbo'].map((model) => <div key={model}><strong>{model}</strong><span className="quiet">Status unavailable</span><button type="button" className="button" disabled><Download size={14} />Download</button></div>)}</div>
      <label className="form-field">Default transcription model<select disabled defaultValue="unavailable"><option value="unavailable">Not available</option></select></label>
    </section>
    <section className="settings-subsection"><h2>Remotion licence</h2><p className="settings-intro">Acknowledgement status isn't connected. Remotion compositions remain unavailable until the licence flow is implemented.</p><p className="field-note">Acknowledging the terms does not purchase a licence.</p></section>
  </div>;
}
