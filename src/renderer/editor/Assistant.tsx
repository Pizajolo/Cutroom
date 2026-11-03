import { useRef, useState } from 'react';
import { IpcFailure } from '@shared/ipc';
import { api } from '../lib/api';
import { errorMessage, useNavigation } from '../state/navigation';
import { Notice } from '../components/Notice';
import { Dialog } from '../components/Dialog';
import { VoiceButton } from '../components/VoiceButton';
import { useAssistant, AGENT_MODELS } from './assistantStore';
import { useEditor } from './store';
import { useSelection } from './selection/store';
import { previewClock } from './preview/store';
import { summarizeOperation, type OperationSummary } from './operationSummary';

export function Assistant() {
  const state = useAssistant();
  const [conflict, setConflict] = useState<{ requestId: string; itemIds?: string[]; details: unknown } | null>(null);
  const [resolution, setResolution] = useState<'keepCurrent' | 'restoreOriginal'>('keepCurrent');
  const [reviewBusy, setReviewBusy] = useState(false);
  const pendingPermissions = useRef(new Set<string>());
  const [permissionBusy, setPermissionBusy] = useState<string[]>([]);
  const activeRun = state.sending || ['starting', 'thinking', 'running', 'waiting_permission'].includes(state.status);
  const permission = async (requestId: string, allow: boolean) => {
    if (pendingPermissions.current.has(requestId)) return;
    const sessionId = state.sessionId;
    pendingPermissions.current.add(requestId); setPermissionBusy([...pendingPermissions.current]);
    try { await api.invoke('agent.respondPermission', { requestId, allow }); if (useAssistant.getState().sessionId === sessionId) useAssistant.setState((s) => ({ permissions: s.permissions.filter((p) => p.requestId !== requestId) })); }
    catch (r) { if (useAssistant.getState().sessionId === sessionId) useAssistant.setState({ error: errorMessage(r) }); }
    finally { pendingPermissions.current.delete(requestId); setPermissionBusy([...pendingPermissions.current]); }
  };
  const review = async (requestId: string, keep: boolean, itemIds?: string[], chosen?: 'keepCurrent' | 'restoreOriginal') => {
    setReviewBusy(true);
    try { await api.invoke(keep ? 'agent.review.keep' : 'agent.review.revert', { requestId, ...(itemIds ? { itemIds } : {}), ...(!keep && chosen ? { resolution: chosen } : {}) }); useAssistant.setState((s) => ({ changes: s.changes.filter((c) => c.requestId !== requestId || (!!itemIds && !itemIds.includes(c.itemId))) })); setConflict(null); void useEditor.getState().reload(); }
    catch (r) { if (r instanceof IpcFailure && r.code === 'conflict') { setResolution('keepCurrent'); setConflict({ requestId, itemIds, details: r.details }); } else useAssistant.setState({ error: errorMessage(r) }); }
    finally { setReviewBusy(false); }
  };
  return <div className="assistant-dock"><div className="panel-heading"><h2>{state.mode === 'ask' ? 'Read-only' : 'Assistant'}</h2><span className="quiet">{state.status}</span></div><label className="form-field">Model<select disabled={activeRun} value={state.model} onChange={(e) => useAssistant.setState({ model: e.target.value, sessionId: null })}>{AGENT_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
    <div className="assistant-messages" role="log" aria-label="Assistant conversation">{!state.messages.length && <p className="field-note">Describe a change, or ask a read-only question. You review changes before keeping them.</p>}{state.messages.map((m, i) => <article key={i} className={`chat-${m.role}`}><h3>{m.role === 'user' ? 'You' : 'Claude'}</h3><p>{m.text}</p></article>)}</div>
    {!!state.tools.length && <details><summary>Tool activity · {state.tools.length}</summary><ul>{state.tools.map((t) => <li key={t.id}><details><summary>{t.name} · {t.done ? t.error ? 'Failed' : 'Done' : 'Running…'}</summary>{t.operation && <OperationDetails summary={t.operation} />}</details></li>)}</ul></details>}
    {!!state.changes.length && <section className="change-review"><h3>Review {state.changes.length} changes</h3>{[...new Set(state.changes.map((c) => c.requestId))].map((requestId) => <div key={requestId}><div className="form-row"><button className="button" disabled={reviewBusy} onClick={() => { void review(requestId, true); }}>Keep all</button><button className="button" disabled={reviewBusy} onClick={() => { void review(requestId, false); }}>Revert all</button></div>{state.changes.filter((c) => c.requestId === requestId).map((c) => <details key={c.itemId}><summary>{c.itemId} · {c.paths.join(', ')}</summary><div className="comparison"><div><h3>Before</h3><pre>{JSON.stringify(c.before, null, 2)}</pre></div><div><h3>After</h3><pre>{JSON.stringify(c.after, null, 2)}</pre></div></div><div className="form-row"><button className="button" disabled={reviewBusy} onClick={() => { void review(requestId, true, [c.itemId]); }}>Keep</button><button className="button" disabled={reviewBusy} onClick={() => { void review(requestId, false, [c.itemId]); }}>Revert</button></div></details>)}</div>)}</section>}
    <div className="assistant-composer">{state.permissions.map((p) => { const summary = summarizeOperation(p.input); return <section className="permission-prompt" key={p.requestId}><h3>Permission needed · {p.tool}</h3><p>{p.description}</p><OperationDetails summary={summary} />{/download|url/i.test(p.tool) && <p>Only allow downloads you own or have permission to use.</p>}<div className="form-row"><button className="button" disabled={permissionBusy.includes(p.requestId)} onClick={() => { void permission(p.requestId, false); }}>Deny</button><button className="button primary" disabled={summary.truncated || permissionBusy.includes(p.requestId)} onClick={() => { void permission(p.requestId, true); }}>{permissionBusy.includes(p.requestId) ? 'Responding…' : 'Allow'}</button></div></section>; })}{state.error && <Notice danger>{state.error}</Notice>}<label className="form-field">Message<textarea rows={3} value={state.draft} onChange={(e) => useAssistant.setState({ draft: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void state.send(state.draft, state.mode); } }} /></label><VoiceButton onText={(text) => useAssistant.setState((s) => ({ draft: `${s.draft}${s.draft ? ' ' : ''}${text}` }))} /><div className="form-row"><button className="button primary" disabled={state.sending || !state.draft.trim()} onClick={() => { void state.send(state.draft, state.mode); }}>Send</button><button className="button" disabled={!state.sessionId} onClick={() => { if (state.sessionId) void api.invoke('agent.interrupt', { sessionId: state.sessionId }).catch((r: unknown) => useAssistant.setState({ error: errorMessage(r) })); }}>Stop</button></div><p className="field-note">API-equivalent estimate · {state.cost === null ? '—' : `$${state.cost.toFixed(4)}`}</p></div>
    {conflict && <Dialog title="This item changed after Claude's edit" wide onClose={() => setConflict(null)} footer={<><button className="button" autoFocus onClick={() => setConflict(null)}>Cancel</button><button className="button primary" disabled={reviewBusy} onClick={() => { void review(conflict.requestId, false, conflict.itemIds, resolution); }}>Resolve</button></>}><ConflictValues details={conflict.details} /><label className="check-row"><input type="radio" checked={resolution === 'keepCurrent'} onChange={() => setResolution('keepCurrent')} />Keep current</label><label className="check-row"><input type="radio" checked={resolution === 'restoreOriginal'} onChange={() => setResolution('restoreOriginal')} />Restore original</label></Dialog>}
  </div>;
}
function OperationDetails({ summary }: { summary: OperationSummary }) {
  return <div><h4>Operation</h4><pre className="draft-preview">{summary.text}</pre><p className="field-note">Credentials and environment values are redacted.{summary.truncated && ' This operation is too large to review safely. Deny it and request a smaller operation.'}</p></div>;
}
function ConflictValues({ details }: { details: unknown }) {
  const entries = details && typeof details === 'object' && 'conflicts' in details && Array.isArray(details.conflicts) ? details.conflicts : [];
  if (!entries.length) return <p className="field-note">The affected values are unavailable. Keep the current edit, or cancel and review it in the inspector.</p>;
  return <>{entries.map((entry: unknown, index: number) => {
    if (!entry || typeof entry !== 'object') return null;
    const value = entry as Record<string, unknown>;
    return <section key={index}><h3>{String(value.itemId ?? 'Item')} · {String(value.path ?? '')}</h3><div className="comparison">{(['original', 'agent', 'current'] as const).map((key) => <section key={key}><h3>{key === 'original' ? 'Original' : key === 'agent' ? 'Agent' : 'Current'}</h3><pre>{value[key] === undefined ? 'Property absent' : JSON.stringify(value[key], null, 2)}</pre></section>)}</div></section>;
  })}</>;
}
export function AskDialog({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'ask' | 'edit'>('edit');
  const [context] = useState(() => ({ itemIds: useSelection.getState().elements.map((s) => s.itemId), time: previewClock.getSnapshot().time }));
  const selection = context.itemIds;
  const time = context.time;
  const sending = useAssistant((s) => s.sending);
  const send = async () => { if (await useAssistant.getState().send(text, mode, context)) { useNavigation.setState({ destination: 'project', tab: 'Editor', dock: 'Assistant' }); onClose(); } };
  return <Dialog title="Ask Claude" onClose={onClose} footer={<><button className="button" onClick={onClose}>Cancel</button><button className="button primary" disabled={sending || !text.trim()} onClick={() => { void send(); }}>Send <kbd>⌘Enter</kbd></button></>}><p className="context-chip">{selection.length ? `${selection.length} selected items` : 'Whole edit'} · {time.toFixed(2)} s</p><label className="check-row"><input type="checkbox" checked={mode === 'ask'} onChange={(e) => setMode(e.target.checked ? 'ask' : 'edit')} />Ask a question</label>{mode === 'ask' && <p className="field-note">Read-only · won't change files</p>}<label className="form-field">Your request<textarea autoFocus rows={3} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }} /></label><VoiceButton onText={(value) => setText((s) => `${s}${s ? ' ' : ''}${value}`)} />{useAssistant((s) => s.error) && <Notice danger>{useAssistant.getState().error}</Notice>}</Dialog>;
}
