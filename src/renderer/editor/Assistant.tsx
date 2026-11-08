import { useEffect, useRef, useState } from 'react';
import { PanelLeftClose } from 'lucide-react';
import { IpcFailure } from '@shared/ipc';
import { api } from '../lib/api';
import { errorMessage, useNavigation } from '../state/navigation';
import { Notice } from '../components/Notice';
import { Dialog } from '../components/Dialog';
import { VoiceButton } from '../components/VoiceButton';
import { VideoTypePicker } from '../components/VideoTypePicker';
import { SaveSkillDialog } from '../pages/Skills';
import { useSkills } from '../lib/useSkills';
import { useAssistant, AGENT_MODELS, type Question } from './assistantStore';
import { useEditor } from './store';
import { summarizeOperation, type OperationSummary } from './operationSummary';

const statusText: Record<string, string> = { idle: 'Ready', starting: 'Working', thinking: 'Working', running: 'Working', waiting_input: 'Waiting for your answer', waiting_permission: 'Needs permission', interrupted: 'Stopped', finished: 'Ready' };
export function Assistant() {
  const state = useAssistant();
  const focusRequest = useNavigation((s) => s.chatFocusRequest);
  const [conflict, setConflict] = useState<{ requestId: string; itemIds?: string[]; details: unknown } | null>(null);
  const [resolution, setResolution] = useState<'keepCurrent' | 'restoreOriginal'>('keepCurrent');
  const [reviewBusy, setReviewBusy] = useState(false);
  const pendingPermissions = useRef(new Set<string>());
  const [permissionBusy, setPermissionBusy] = useState<string[]>([]);
  const [approval, setApproval] = useState<'auto' | 'ask' | null>(null);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [approvalError, setApprovalError] = useState('');
  const [stopping, setStopping] = useState(false);
  const [saveSkill, setSaveSkill] = useState(false);
  const stream = useRef<HTMLDivElement>(null), composer = useRef<HTMLTextAreaElement>(null);
  const atBottom = useRef(true);
  const [newActivity, setNewActivity] = useState(false);
  const { data: skills } = useSkills();
  const activeRun = state.sending || ['starting', 'thinking', 'running', 'waiting_permission', 'waiting_input'].includes(state.status);
  useEffect(() => { let active = true; void api.invoke('settings.get', {}).then((settings) => { if (active) setApproval(settings.agent.approvalMode); }).catch((r: unknown) => { if (active) setApprovalError(errorMessage(r)); }); return () => { active = false; }; }, []);
  useEffect(() => { if (focusRequest) composer.current?.focus(); }, [focusRequest]);
  useEffect(() => { const input = composer.current; if (input) { input.style.height = 'auto'; input.style.height = `${input.scrollHeight}px`; } }, [state.draft]);
  useEffect(() => { if (atBottom.current && stream.current) stream.current.scrollTop = stream.current.scrollHeight; else setNewActivity(true); }, [state.messages, state.tools, state.questions, state.permissions, state.changes, state.error]);
  const permission = async (requestId: string, allow: boolean, scope: 'once' | 'session' = 'once') => {
    if (pendingPermissions.current.has(requestId)) return;
    const sessionId = state.sessionId;
    pendingPermissions.current.add(requestId); setPermissionBusy([...pendingPermissions.current]);
    try { await api.invoke('agent.respondPermission', { requestId, allow, scope }); if (useAssistant.getState().sessionId === sessionId) useAssistant.setState((s) => ({ permissions: s.permissions.filter((p) => p.requestId !== requestId) })); }
    catch (r) { if (useAssistant.getState().sessionId === sessionId) useAssistant.setState({ error: errorMessage(r) }); }
    finally { pendingPermissions.current.delete(requestId); setPermissionBusy([...pendingPermissions.current]); }
  };
  const review = async (requestId: string, keep: boolean, itemIds?: string[], chosen?: 'keepCurrent' | 'restoreOriginal') => {
    const sessionId = state.sessionId;
    setReviewBusy(true);
    try { await api.invoke(keep ? 'agent.review.keep' : 'agent.review.revert', { requestId, ...(itemIds ? { itemIds } : {}), ...(!keep && chosen ? { resolution: chosen } : {}) }); if (useAssistant.getState().sessionId !== sessionId) return; useAssistant.setState((s) => ({ changes: s.changes.filter((c) => c.requestId !== requestId || (!!itemIds && !itemIds.includes(c.itemId))) })); setConflict(null); void useEditor.getState().reload(); return true; }
    catch (r) { if (useAssistant.getState().sessionId !== sessionId) return; if (r instanceof IpcFailure && r.code === 'conflict') { setResolution('keepCurrent'); setConflict({ requestId, itemIds, details: r.details }); } else useAssistant.setState({ error: errorMessage(r) }); return false; }
    finally { setReviewBusy(false); }
  };
  const updateApproval = async (checked: boolean) => {
    setApprovalBusy(true); setApprovalError('');
    try { const settings = await api.invoke('settings.update', { patch: { agent: { approvalMode: checked ? 'auto' : 'ask' } } }); setApproval(settings.agent.approvalMode); }
    catch (r) { setApprovalError(errorMessage(r)); } finally { setApprovalBusy(false); }
  };
  const stop = async () => { if (!state.sessionId || stopping) return; setStopping(true); try { await api.invoke('agent.interrupt', { sessionId: state.sessionId }); } catch (r) { useAssistant.setState({ error: errorMessage(r) }); } finally { setStopping(false); } };
  return <div className="assistant-dock"><div className="panel-heading"><h2>Chat</h2><span className="quiet" role="status">{stopping ? 'Stopping…' : statusText[state.status] ?? 'Failed'}</span><button className="icon-button" aria-label="Collapse chat" onClick={() => useNavigation.setState({ chatCollapsed: true })}><PanelLeftClose size={16} /></button></div>
    <div className="assistant-stream" ref={stream} onScroll={() => { const el = stream.current; atBottom.current = !!el && el.scrollHeight - el.scrollTop - el.clientHeight < 40; if (atBottom.current) setNewActivity(false); }}>
      <div className="assistant-messages" role="log" aria-label="Assistant conversation">{!state.messages.length && <><p className="field-note">Describe your video or an edit. Claude will ask for missing details before starting.</p><div className="video-starters">{skills?.slice(0, 4).map((skill) => <button className="button" key={skill.id} onClick={() => useAssistant.setState({ skillId: skill.id })}>{skill.name}</button>)}</div></>}{state.messages.map((m, i) => <article key={i} className={`chat-${m.role}`}><h3>{m.role === 'user' ? 'You' : 'Claude'}</h3><p>{m.text}</p></article>)}</div>
      {!!state.tools.length && <details className="tool-activity"><summary>{state.tools.length} tool actions · {[...state.tools].reverse().find((t) => !t.done)?.name ?? 'Completed'}</summary><ul>{state.tools.map((t) => <li key={t.id}><details><summary>{t.name} · {t.done ? t.error ? 'Failed' : 'Done' : 'Running…'}</summary>{t.operation && <OperationDetails summary={t.operation} />}</details></li>)}</ul></details>}
      {state.questions.map((q) => <QuestionCard key={q.requestId} request={q} inactive={['interrupted', 'finished'].includes(state.status)} />)}
      {state.permissions.map((p) => { const summary = summarizeOperation(p.input); const busy = permissionBusy.includes(p.requestId); const inactive = ['interrupted', 'finished'].includes(state.status); return <section className="permission-prompt" key={p.requestId}><h3>Permission needed · {p.tool}</h3>{inactive && <p className="field-note">No longer waiting</p>}<p>{p.description}</p><details><summary>Operation details</summary><OperationDetails summary={summary} /></details>{/download|url/i.test(p.tool) && <p>Only allow downloads you own or have permission to use.</p>}<div className="form-row"><button className="button primary" disabled={summary.truncated || busy || inactive} onClick={() => void permission(p.requestId, true)}>{busy ? 'Responding…' : 'Allow once'}</button>{p.rememberable && <button className="button" disabled={summary.truncated || busy || inactive} onClick={() => void permission(p.requestId, true, 'session')}>Allow for this session</button>}<button className="button" disabled={busy || inactive} onClick={() => void permission(p.requestId, false)}>Deny</button></div></section>; })}
      {!!state.changes.length && <section className="change-review"><div className="form-row"><h3>{state.changes.length} changes</h3><button className="button" disabled={reviewBusy} onClick={() => { void (async () => { for (const id of new Set(state.changes.map((c) => c.requestId))) if (!await review(id, true)) break; })(); }}>Keep all</button><button className="button" disabled={reviewBusy} onClick={() => { void (async () => { for (const id of new Set(state.changes.map((c) => c.requestId))) if (!await review(id, false)) break; })(); }}>Revert all</button></div><details><summary>Details</summary>{state.changes.map((c) => <details key={`${c.requestId}-${c.itemId}`}><summary>{c.itemId} · {c.paths.join(', ')}</summary><div className="comparison"><div><h3>Before</h3><pre>{JSON.stringify(c.before, null, 2)}</pre></div><div><h3>After</h3><pre>{JSON.stringify(c.after, null, 2)}</pre></div></div><div className="form-row"><button className="button" disabled={reviewBusy} onClick={() => void review(c.requestId, true, [c.itemId])}>Keep</button><button className="button" disabled={reviewBusy} onClick={() => void review(c.requestId, false, [c.itemId])}>Revert</button></div></details>)}</details></section>}
      {state.error && <Notice danger action={<button className="button" disabled={activeRun} onClick={() => void state.send(state.draft, state.mode)}>Retry</button>}>{state.error}</Notice>}
      {state.savedSkill && <Notice action={<button className="button" onClick={() => { useAssistant.setState({ skillId: state.savedSkill!.id }); useNavigation.getState().navigate('skills'); }}>View skill</button>}>Saved as {state.savedSkill.name}.</Notice>}
      {!!state.messages.length && <button className="button quiet-button" disabled={activeRun} onClick={() => setSaveSkill(true)}>Save this edit as a skill</button>}
    </div>
    {newActivity && <button className="button" onClick={() => { if (stream.current) stream.current.scrollTop = stream.current.scrollHeight; atBottom.current = true; setNewActivity(false); }}>New activity</button>}
    <div className="assistant-composer"><label className="form-field"><span className="sr-only">Message Claude</span><textarea ref={composer} id="chat-composer" rows={3} placeholder="Describe an edit, or ask a question…" value={state.draft} onChange={(e) => useAssistant.setState({ draft: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (!activeRun) void state.send(state.draft, state.mode); } }} /></label><div className="form-row"><select aria-label="Model" disabled={activeRun} value={state.model} onChange={(e) => useAssistant.setState({ model: e.target.value, sessionId: null, permissions: [], questions: [] })}>{AGENT_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select><VideoTypePicker /><VoiceButton onText={(text) => useAssistant.setState((s) => ({ draft: `${s.draft}${s.draft ? ' ' : ''}${text}` }))} /></div><div className="form-row composer-actions"><label className="check-row" title={approval === 'auto' ? 'Approves enabled editing tools automatically. Download rights, overwrites and external extensions may still ask.' : 'Ask before editing tools run.'}><input role="switch" type="checkbox" checked={approval === 'auto'} disabled={approval === null || approvalBusy} onChange={(e) => void updateApproval(e.target.checked)} />Auto-approve</label><label className="check-row" title="Changing read-only starts a new chat session. Your edit and draft are kept."><input type="checkbox" disabled={activeRun} checked={state.mode === 'ask'} onChange={(e) => useAssistant.setState({ mode: e.target.checked ? 'ask' : 'edit', sessionId: null, permissions: [], questions: [] })} />Read-only</label>{activeRun ? <button className="button" disabled={stopping} onClick={() => void stop()}>{stopping ? 'Stopping…' : 'Stop'}</button> : <button className="button primary" disabled={!state.draft.trim()} onClick={() => void state.send(state.draft, state.mode)}>Send</button>}</div>{approvalBusy && <p className="field-note" role="status">Saving approval setting…</p>}{approvalError && <p className="field-error" role="alert">{approvalError}{approval === null && <button className="button" onClick={() => { void api.invoke('settings.get', {}).then((settings) => { setApproval(settings.agent.approvalMode); setApprovalError(''); }).catch((r: unknown) => setApprovalError(errorMessage(r))); }}>Retry approval setting</button>}</p>}<p className="field-note">Enter to send · Shift+Enter for a new line</p><p className="field-note">Changing read-only starts a new chat session. Your edit and draft are kept.</p></div>
    {saveSkill && <SaveSkillDialog onClose={() => setSaveSkill(false)} />}
    {conflict && <Dialog title="This item changed after Claude's edit" wide onClose={() => setConflict(null)} footer={<><button className="button" autoFocus onClick={() => setConflict(null)}>Cancel</button><button className="button primary" disabled={reviewBusy} onClick={() => void review(conflict.requestId, false, conflict.itemIds, resolution)}>Resolve</button></>}><ConflictValues details={conflict.details} /><label className="check-row"><input type="radio" checked={resolution === 'keepCurrent'} onChange={() => setResolution('keepCurrent')} />Keep current</label><label className="check-row"><input type="radio" checked={resolution === 'restoreOriginal'} onChange={() => setResolution('restoreOriginal')} />Restore original</label></Dialog>}
  </div>;
}

export function QuestionCard({ request, inactive }: { request: Question; inactive: boolean }) {
  const [choices, setChoices] = useState<Record<string, number[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false), [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const answers = Object.fromEntries(request.questions.map((q) => { const values = (choices[q.question] ?? []).map((index) => index === q.options.length ? (other[q.question] ?? '').trim() : q.options[index]!.label); return [q.question, q.multiSelect ? values : values[0] ?? '']; }));
  const valid = request.questions.every((q) => { const values = choices[q.question] ?? []; return values.length && (!values.includes(q.options.length) || !!other[q.question]?.trim()); });
  const send = async () => { if (!valid || busy) return; setBusy(true); setError(''); try { await api.invoke('agent.respondQuestion', { requestId: request.requestId, answers }); if (useAssistant.getState().sessionId === request.sessionId) useAssistant.setState((s) => ({ answeredQuestionIds: [...s.answeredQuestionIds, request.requestId] })); setSent(true); } catch (r) { setError(errorMessage(r)); } finally { setBusy(false); } };
  if (sent) return <details className="question-card"><summary>Answers sent</summary>{request.questions.map((q) => <p key={q.question}><strong>{q.question}</strong>: {Array.isArray(answers[q.question]) ? (answers[q.question] as string[]).join(', ') : answers[q.question]}</p>)}</details>;
  return <section className="question-card"><h3>A few details before I start</h3>{request.questions.map((q) => <fieldset key={q.question} disabled={inactive || busy}><legend>{q.question}</legend>{q.header && <p className="field-note">{q.header}</p>}{[...q.options, { label: 'Other', description: '' }].map((option, index) => { const selected = choices[q.question] ?? []; return <label className="question-option" key={index}><input type={q.multiSelect ? 'checkbox' : 'radio'} name={`${request.requestId}-${q.question}`} checked={selected.includes(index)} onChange={() => setChoices({ ...choices, [q.question]: q.multiSelect ? selected.includes(index) ? selected.filter((v) => v !== index) : [...selected, index] : [index] })} /><span>{option.label}{option.description && <small>{option.description}</small>}</span></label>; })}{choices[q.question]?.includes(q.options.length) && <label className="form-field">Other answer<input value={other[q.question] ?? ''} onChange={(e) => setOther({ ...other, [q.question]: e.target.value })} /></label>}</fieldset>)}{error && <Notice danger>{error}</Notice>}{inactive ? <p className="field-note">No longer waiting</p> : <><button className="button primary" disabled={!valid || busy} onClick={() => void send()}>{busy ? 'Sending…' : error ? 'Retry' : 'Send answers'}</button>{!valid && <p className="field-note">Answer each question to continue.</p>}</>}</section>;
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
