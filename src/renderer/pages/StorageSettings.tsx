import { useCallback, useEffect, useState } from 'react';
import { IpcFailure, type InvokeRes } from '@shared/ipc';
import type { GlobalSettings } from '@shared/schema/settings';
import { storageCategorySchema, type SnapshotInfo } from '@shared/schema/editor';
import { api } from '../lib/api';
import { formatBytes } from '../lib/time';
import { errorMessage, useNavigation } from '../state/navigation';
import { Dialog } from '../components/Dialog';
import { Notice } from '../components/Notice';
import { DraftActions, useSettingsDraft } from './WorkspaceSettings';
import { useEditor } from '../editor/store';

export function StorageSettings({ settings }: { settings: GlobalSettings }) {
  const project = useNavigation((s) => s.project);
  const form = useSettingsDraft(settings.snapshots, (snapshots) => ({ snapshots }));
  const [usage, setUsage] = useState<InvokeRes<'storage.usage'> | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotInfo[] | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [modal, setModal] = useState<'clean' | 'create' | { action: 'restore' | 'delete'; snapshot: SnapshotInfo } | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [preview, setPreview] = useState<InvokeRes<'storage.cleanPreview'> | null>(null);
  const [expired, setExpired] = useState(false);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    try { const value = await api.invoke('storage.usage', {}); setUsage(value); if (project) setSnapshots(await api.invoke('snapshots.list', {})); }
    catch (r) { setError(errorMessage(r)); }
  }, [project]);
  useEffect(() => { let active = true; void Promise.all([api.invoke('storage.usage', {}), project ? api.invoke('snapshots.list', {}) : Promise.resolve(null)]).then(([value, list]) => { if (active) { setUsage(value); setSnapshots(list); } }).catch((r: unknown) => { if (active) setError(errorMessage(r)); }); return () => { active = false; }; }, [project]);
  const close = () => { if (!busy) { setModal(null); setPreview(null); } };
  const run = async (action: () => Promise<unknown>, done: string) => {
    if (busy) return; setBusy(true); setError(''); setSuccess('');
    try { await action(); if (modal && typeof modal === 'object' && modal.action === 'restore') await useEditor.getState().reload(); setSuccess(done); setModal(null); setPreview(null); await refresh(); }
    catch (r) {
      const invalidToken = modal === 'clean' && r instanceof IpcFailure && r.code === 'forbidden';
      if (invalidToken) setExpired(true);
      setError(invalidToken ? 'This cleanup preview expired. Review the current files before removing anything.' : errorMessage(r));
      await refresh();
    } finally { setBusy(false); }
  };
  const cleanPreview = async () => {
    setBusy(true); setError('');
    try { setPreview(await api.invoke('storage.cleanPreview', { categories: categories.map((c) => storageCategorySchema.parse(c)) })); setExpired(false); }
    catch (r) { setError(errorMessage(r)); } finally { setBusy(false); }
  };
  return <div className="settings-form"><p>See what uses space and remove generated files. Source media and finished exports are never included in cleanup.</p>{error && !modal && <Notice danger action={<button className="button" onClick={() => { void refresh(); }}>Retry</button>}>{error}</Notice>}{success && <p role="status">{success}</p>}
    <table className="settings-table"><thead><tr><th>Location</th><th>Used</th><th>Cleanup</th></tr></thead><tbody>{usage ? usage.categories.map((c) => <tr key={c.category}><td>{c.category}</td><td>{formatBytes(c.bytes)}</td><td>{String(c.category) === 'tools' ? 'Managed in Tools' : String(c.category) === 'models' ? 'Manage models in Tools' : String(c.category) === 'final' ? 'Never cleaned here' : `${c.items} generated items`}</td></tr>) : <tr><td colSpan={3}>Loading storage usage…</td></tr>}{usage && !usage.categories.some((c) => String(c.category) === 'tools') && <tr><td>Tools</td><td>Unavailable</td><td>Managed in Tools</td></tr>}{usage && !usage.categories.some((c) => String(c.category) === 'models') && <tr><td>Models</td><td>Unavailable</td><td>Manage models in Tools</td></tr>}{usage && !usage.categories.some((c) => String(c.category) === 'final') && <tr><td>Finished exports (final/)</td><td>Unavailable</td><td>Never cleaned here</td></tr>}</tbody></table>
    <button className="button" disabled={!project} onClick={() => { setCategories([]); setPreview(null); setError(''); setModal('clean'); }}>Review cleanup</button>{!project && <p className="field-note">Open a project to manage generated files and snapshots.</p>}
    <h3>Snapshot retention</h3><div className="form-row"><label className="form-field">Keep snapshots for (days)<input type="number" min={1} value={form.draft.retainDays} onChange={(e) => form.setDraft({ ...form.draft, retainDays: Number(e.target.value) })} /></label><label className="form-field">Maximum snapshot storage (GB)<input type="number" min={0.001} step={0.1} value={form.draft.maxBytes / 1e9} onChange={(e) => form.setDraft({ ...form.draft, maxBytes: Math.round(Number(e.target.value) * 1e9) })} /></label></div><label className="check-row"><input type="checkbox" checked={form.draft.autoBeforeAgent} onChange={(e) => form.setDraft({ ...form.draft, autoBeforeAgent: e.target.checked })} />Before Claude edits</label><label className="check-row"><input type="checkbox" checked={form.draft.autoBeforeExport} onChange={(e) => form.setDraft({ ...form.draft, autoBeforeExport: e.target.checked })} />Before export</label><p className="field-note">The newest snapshot is kept when retention cleanup runs. 1 GB = 1,000,000,000 bytes. Snapshots don't back up source media.</p>{form.error && <Notice danger>{form.error}</Notice>}<DraftActions {...form} valid={Number.isInteger(form.draft.retainDays) && form.draft.retainDays > 0 && form.draft.maxBytes > 0} save={() => { void form.save(); }} />
    <div className="section-heading"><h3>Snapshots</h3><button className="button" disabled={!project} onClick={() => { setLabel(''); setError(''); setModal('create'); }}>Create snapshot</button></div>{!project ? <p>Open a project.</p> : !snapshots ? <p role="status">Loading snapshots…</p> : !snapshots.length ? <p className="field-note">No snapshots yet. Create one before making a large change.</p> : <ul className="snapshot-list">{snapshots.map((snapshot) => <li key={snapshot.id}><div><strong>{snapshot.label}</strong><p className="field-note">{new Date(snapshot.createdAt).toLocaleString()} · {formatBytes(snapshot.bytes)} · revision {snapshot.revision}</p></div><button className="button" onClick={() => { setError(''); setModal({ action: 'restore', snapshot }); }}>Restore</button><button className="button quiet-button" onClick={() => { setError(''); setModal({ action: 'delete', snapshot }); }}>Delete</button></li>)}</ul>}
    {modal && <Dialog title={modal === 'clean' ? preview ? 'Review files to remove' : 'Review cleanup' : modal === 'create' ? 'Create snapshot' : modal.action === 'restore' ? `Restore ‘${modal.snapshot.label}’?` : 'Delete snapshot?'} onClose={close} footer={<><button className="button" autoFocus disabled={busy} onClick={close}>Cancel</button>{modal === 'clean' ? preview ? <button className="button danger" disabled={busy || expired || !preview.items.length} onClick={() => { void run(() => api.invoke('storage.clean', { token: preview.token }), `Removed ${preview.items.length} items.`); }}>{busy ? 'Removing…' : `Remove ${preview.items.length} items`}</button> : <button className="button primary" disabled={busy || !categories.length} onClick={() => { void cleanPreview(); }}>{busy ? 'Preparing…' : 'Preview cleanup'}</button> : modal === 'create' ? <button className="button primary" disabled={busy || !label.trim()} onClick={() => { void run(() => api.invoke('snapshots.create', { label: label.trim() }), 'Snapshot created.'); }}>Create snapshot</button> : <button className={`button ${modal.action === 'delete' ? 'danger' : 'primary'}`} disabled={busy} onClick={() => { void run(() => api.invoke(modal.action === 'delete' ? 'snapshots.delete' : 'snapshots.restore', { id: modal.snapshot.id }), modal.action === 'delete' ? 'Snapshot deleted.' : 'Timeline restored. You can undo this change in the editor.'); }}>{modal.action === 'delete' ? 'Delete snapshot' : 'Restore snapshot'}</button>}</>}>
      {modal === 'clean' ? preview ? <><p>{preview.items.length} items · {formatBytes(preview.bytes)}</p><ul className="cleanup-items">{preview.items.map((i) => <li key={i.rel}><span className="literal-path">{i.rel}</span><span>{formatBytes(i.bytes)}{i.category === 'snapshots' && ' · Recovery point'}</span></li>)}</ul><p>Footage, references, assets and finished exports will be kept.</p></> : <><p>Select generated files to review. Preview cleanup deletes nothing.</p>{storageCategorySchema.options.filter((c) => !['tools', 'models', 'final'].includes(c)).map((c) => <label className="check-row" key={c}><input type="checkbox" checked={categories.includes(c)} onChange={(e) => setCategories(e.target.checked ? [...categories, c] : categories.filter((v) => v !== c))} />{c}</label>)}</> : modal === 'create' ? <label className="form-field">Label<input value={label} maxLength={500} placeholder="Before recut" onChange={(e) => setLabel(e.target.value)} /></label> : modal.action === 'restore' ? <><p>This restores the saved timeline. It doesn't replace source media or finished exports. You can undo the timeline restore.</p><p className="field-note">{new Date(modal.snapshot.createdAt).toLocaleString()}</p></> : <><p>{modal.snapshot.label}</p><p>This recovery point will be permanently removed. Your current edit won't change.</p></>}{error && <Notice danger>{error}<button className="button" onClick={() => { setPreview(null); setError(''); }}>Review again</button></Notice>}
    </Dialog>}
  </div>;
}
