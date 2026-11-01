import { useState } from 'react';
import { Circle, CircleCheck, Download, RefreshCw, ShieldAlert } from 'lucide-react';
import type { ToolInfo } from '@shared/schema/media';
import type { WhisperModelInfo } from '@shared/schema/models';
import { api } from '../lib/api';
import { formatSize, isInstalling, modelRevision, receiveModels, useModels, useTools } from '../lib/useTools';
import { Notice } from '../components/Notice';
import { Dialog } from '../components/Dialog';
import { InstallProgress } from '../components/InstallProgress';

function ToolStatus({ tool }: { tool: ToolInfo }) {
  if (tool.install) return <InstallProgress name={tool.name} install={tool.install} />;
  const Icon = tool.status === 'ok' ? CircleCheck : tool.status === 'checksum_mismatch' ? ShieldAlert : Circle;
  return <div className="install-status"><span className={`tool-status${tool.status === 'missing' ? '' : ` tool-${tool.status}`}`}><Icon size={14} aria-hidden="true" />{tool.status === 'ok' ? 'OK' : tool.status === 'checksum_mismatch' ? 'Checksum mismatch' : tool.hint ? 'Build required' : 'Not installed'}</span>
    {tool.status === 'checksum_mismatch' && <span className="field-note">Can't be used until repaired.</span>}
  </div>;
}

export function Tools() {
  const { data: tools, error: toolsError, retry: retryTools } = useTools();
  const { data: models, error: modelsError, retry: retryModels } = useModels();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [checks, setChecks] = useState<Record<string, { current: string; latest: string | null }>>({});
  const [deleting, setDeleting] = useState<WhisperModelInfo | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const run = async (id: string, action: () => Promise<unknown>) => {
    setError(null); setPending((value) => ({ ...value, [id]: true }));
    try { await action(); } catch (reason: unknown) { setError(`${id}: ${reason instanceof Error ? reason.message : 'The operation could not be completed.'}`); }
    finally { setPending((value) => ({ ...value, [id]: false })); }
  };
  const installed = models?.filter((model) => model.status === 'installed' && !isInstalling(model.install)) ?? [];
  const defaultModel = models?.find((model) => model.isDefault);
  const selectedDefault = installed.some((model) => model.isDefault) ? defaultModel?.name : '';
  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteError(null); setPending((value) => ({ ...value, delete: true }));
    try { await api.invoke('models.delete', { name: deleting.name }); setDeleting(null); }
    catch (reason: unknown) { setDeleteError(reason instanceof Error ? reason.message : 'The model could not be deleted.'); }
    finally { setPending((value) => ({ ...value, delete: false })); }
  };
  return <div className="tools-settings">
    <div className="section-heading"><h2>Video and transcription tools</h2><button type="button" className="button" onClick={() => { void retryTools(); void retryModels(); }}><RefreshCw size={14} aria-hidden="true" />Check again</button></div>
    <p className="settings-intro">Cutroom downloads these tools automatically and verifies each one by checksum before use.</p>
    {toolsError && <Notice danger action={<button type="button" className="button" onClick={() => void retryTools()}>Retry tools check</button>}>{toolsError}</Notice>}
    {error && <Notice danger>{error}</Notice>}
    {!tools && !toolsError ? <p role="status">Checking tools…</p> : tools && <div className="table-scroll" role="region" aria-label="Video and transcription tools" tabIndex={0}><table className="tools-table tools-table-live"><thead><tr><th scope="col">Tool</th><th scope="col">Version</th><th scope="col">Source</th><th scope="col">Verification</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead>
      <tbody>{tools.map((tool) => {
        const busy = isInstalling(tool.install);
        const checked = checks[tool.name]?.current === tool.version ? checks[tool.name] : undefined;
        const latest = tool.latestVersion ?? checked?.latest;
        const source = tool.source === 'bundled' ? 'Bundled' : tool.source === 'downloaded' ? 'Downloaded' : 'Updated';
        return <tr key={tool.name}><th scope="row">{tool.name}</th><td>{tool.version || '—'}</td><td>{source}{tool.status !== 'ok' && tool.source !== 'bundled' ? ' (when installed)' : ''}</td><td>{tool.verification === 'pinned' ? 'Pinned checksum' : tool.verification === 'upstream' ? 'Publisher checksum' : 'Not verified yet'}</td><td><ToolStatus tool={tool} />{tool.hint && <p className="tool-hint">{tool.hint}</p>}</td><td><div className="tool-actions">
          {tool.install?.state === 'downloading' && <button type="button" className="button" disabled={pending[`cancel:${tool.name}`]} aria-label={`Cancel ${tool.name} download`} onClick={() => void run(`cancel:${tool.name}`, () => api.invoke('tools.cancelInstall', { name: tool.name }))}>Cancel</button>}
          {!busy && !tool.hint && (tool.install?.state === 'failed' || tool.status !== 'ok') && <button type="button" className="button" disabled={pending[tool.name]} aria-label={`${tool.install?.state === 'failed' || tool.status === 'checksum_mismatch' ? 'Retry' : 'Install'} ${tool.name}`} onClick={() => void run(tool.name, () => api.invoke('tools.install', { name: tool.name }))}>{tool.install?.state === 'failed' || tool.status === 'checksum_mismatch' ? 'Retry' : 'Install'}</button>}
          {tool.updatable && tool.status === 'ok' && !busy && <>
            <button type="button" className="button" disabled={pending[tool.name]} onClick={() => void run(tool.name, async () => { const result = await api.invoke('tools.checkUpdate', { name: tool.name }); setChecks((value) => ({ ...value, [tool.name]: result })); })}>{pending[tool.name] ? 'Checking…' : 'Check for updates'}</button>
            {latest && latest !== tool.version ? <button type="button" className="button" disabled={pending[tool.name]} onClick={() => void run(tool.name, () => api.invoke('tools.update', { name: tool.name }))}>Update to {latest}</button> : checked && <span className="install-meta" role="status">Up to date</span>}
          </>}
        </div></td></tr>;
      })}</tbody></table></div>}
    <section className="settings-subsection" aria-labelledby="whisper-models-title"><h2 id="whisper-models-title">Whisper models</h2><p className="settings-intro">The default model downloads after the tools. Larger models use more storage.</p>
      {modelsError && <Notice danger action={<button type="button" className="button" onClick={() => void retryModels()}>Retry models check</button>}>{modelsError}</Notice>}
      {!models && !modelsError && <p role="status">Checking models…</p>}
      {models && <div className="model-list model-list-live">{models.map((model) => <div key={model.name} role="group" aria-label={`${model.name} model`}>
        <span className="model-name"><strong>{model.name}</strong>{model.isDefault && <span className="default-model-tag">Default</span>}</span><span className="model-size">{formatSize(model.sizeBytes)}</span>
        <div className="model-state">{model.install ? <InstallProgress name={`${model.name} model`} install={model.install} /> : <span className={`tool-status${model.status === 'installed' ? ' tool-ok' : model.status === 'checksum_mismatch' ? ' tool-checksum_mismatch' : ''}`}>{model.status === 'installed' ? <CircleCheck size={14} aria-hidden="true" /> : <Circle size={14} aria-hidden="true" />}{model.status === 'installed' ? 'Installed' : model.status === 'missing' ? 'Not downloaded' : 'Checksum mismatch'}</span>}</div>
        <div className="model-actions">{model.install?.state === 'downloading' ? <button type="button" className="button" disabled={pending[`cancel:${model.name}`]} aria-label={`Cancel ${model.name} model download`} onClick={() => void run(`cancel:${model.name}`, () => api.invoke('models.cancel', { name: model.name }))}>Cancel</button> : !isInstalling(model.install) && (model.status === 'installed' && model.install?.state !== 'failed' ? <button type="button" className="button" disabled={pending[model.name]} aria-label={`Delete ${model.name} model`} onClick={() => { setDeleteError(null); setDeleting(model); }}>Delete</button> : <button type="button" className="button" disabled={pending[model.name]} aria-label={`${model.install?.state === 'failed' || model.status === 'checksum_mismatch' ? 'Retry' : 'Download'} ${model.name} model`} onClick={() => void run(model.name, () => api.invoke('models.download', { name: model.name }))}><Download size={14} aria-hidden="true" />{model.install?.state === 'failed' || model.status === 'checksum_mismatch' ? 'Retry' : 'Download'}</button>)}</div>
      </div>)}</div>}
      <label className="form-field">Default transcription model<select disabled={!installed.length || pending.default} value={selectedDefault ?? ''} onChange={(event) => { const name = installed.find((model) => model.name === event.target.value)?.name; if (name) void run('default', async () => { const revision = modelRevision(); receiveModels(await api.invoke('models.setDefault', { name }), revision); }); }}>
        {!selectedDefault && <option value="" disabled>{installed.length ? 'Choose an installed model' : 'Waiting for a model'}</option>}{installed.map((model) => <option key={model.name} value={model.name}>{model.name}</option>)}
      </select></label>
      {!installed.length && <p className="field-note">Choose a default after a model finishes downloading.</p>}
      {defaultModel && !selectedDefault && <p className="field-note">Current default: {defaultModel.name} (not installed).</p>}
    </section>
    <section className="settings-subsection"><h2>Remotion licence</h2><p className="settings-intro">Acknowledgement status isn't connected. Remotion compositions remain unavailable until the licence flow is implemented.</p><p className="field-note">Acknowledging the terms does not purchase a licence.</p></section>
    {deleting && <Dialog title={`Delete ${deleting.name} model?`} onClose={() => { if (!pending.delete) setDeleting(null); }} footer={<><button type="button" className="button" autoFocus disabled={pending.delete} onClick={() => setDeleting(null)}>Cancel</button><button type="button" className="button danger" disabled={pending.delete} onClick={() => void confirmDelete()}>{pending.delete ? 'Deleting…' : 'Delete model'}</button></>}><p>This frees {formatSize(deleting.sizeBytes)} of local storage. You can download it again.</p>{deleting.isDefault && <p>This is your default model. Transcription will need an installed model.</p>}{deleteError && <Notice danger>{deleteError}</Notice>}</Dialog>}
  </div>;
}
