import { useEffect, useRef, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { errorMessage, useNavigation } from '../state/navigation';
import { BrowseMediaButton } from '../media/MediaBrowser';
import { accountMethodLabel, useAccounts } from '../lib/useAccounts';
import { VoiceButton } from '../components/VoiceButton';
import { Notice } from '../components/Notice';
import { ProjectActions } from './Projects';
import { useAssistant } from '../editor/assistantStore';
export { ProjectActions } from './Projects';

export function Home() {
  const draft = useNavigation((s) => s.goalDraft);
  const current = useNavigation((s) => s.project);
  const recents = useNavigation((s) => s.recentProjects);
  const focusRequest = useNavigation((s) => s.goalFocusRequest);
  const { data: accounts, error: accountsError } = useAccounts();
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const chosen = selected ?? current?.project.id ?? '';
  const claude = accounts?.find((a) => a.provider === 'anthropic');
  const elevenlabs = accounts?.find((a) => a.provider === 'elevenlabs');
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (focusRequest > 0) ref.current?.focus(); }, [focusRequest]);
  const reason = !chosen ? 'Choose or create a project to start.' : claude?.status !== 'connected' ? accountsError ?? 'Connect Claude to start the assistant. You can edit manually.' : !draft.trim() ? 'Describe what you want to make.' : '';
  const start = async () => {
    if (reason || busy) return;
    const goal = draft; setBusy(true); setError('');
    try {
      if (current?.project.id !== chosen) { await useNavigation.getState().openRecent(chosen); if (useNavigation.getState().project?.project.id !== chosen) throw new Error(useNavigation.getState().projectError ?? 'The project could not be opened.'); }
      useNavigation.setState({ destination: 'project', tab: 'Editor', dock: 'Assistant' });
      if (await useAssistant.getState().send(goal)) { if (useNavigation.getState().goalDraft === goal) useNavigation.getState().setGoalDraft(''); }
    } catch (r) { setError(errorMessage(r)); } finally { setBusy(false); }
  };
  return <div className="page home-page" data-workspace-region tabIndex={-1}><div className="page-heading"><h1>What do you want to make?</h1></div><section className="goal-section" aria-label="New goal"><label htmlFor="home-goal" className="sr-only">Describe your video</label><div className="goal-composer"><textarea id="home-goal" ref={ref} value={draft} onChange={(e) => useNavigation.getState().setGoalDraft(e.target.value)} placeholder="Cut a 60-second teaser from my footage, with animated titles and a voiceover…" /><div className="composer-toolbar"><VoiceButton onText={(text) => { const s = useNavigation.getState(); s.setGoalDraft(`${s.goalDraft}${s.goalDraft ? ' ' : ''}${text}`); }} /><span className="composer-hint">New goal <kbd>⌘N</kbd></span></div></div>
    <div className="home-project-row"><label className="form-field">Project<select value={chosen} onChange={(e) => { if (e.target.value === '__new') useNavigation.getState().newProject(); else if (e.target.value === '__open') void useNavigation.getState().pickProject(); else setSelected(e.target.value); }}><option value="">Choose a project</option>{current && !recents.some((r) => r.id === current.project.id) && <option value={current.project.id}>{current.project.name}</option>}{recents.map((r) => <option key={r.id} value={r.id} disabled={r.missing}>{r.name} · {r.missing ? 'Folder not found' : r.rootPath}</option>)}<option value="__new">New project…</option><option value="__open">Open project…</option></select></label><button className="button primary" disabled={!!reason || busy} aria-describedby="goal-service-note" onClick={() => { void start(); }}><ArrowUp size={16} />{busy ? 'Starting…' : 'Start'}</button></div><p className="field-note" id="goal-service-note">{reason || 'Claude will work in this project. You review changes before keeping them.'}</p>{chosen && claude?.status !== 'connected' && <button className="button" onClick={() => { useNavigation.getState().setSettingsSection('Accounts'); useNavigation.getState().navigate('settings'); }}>Connect Claude</button>}{chosen && <button className="button quiet-button" onClick={() => { if (current?.project.id === chosen) useNavigation.getState().setTab('Editor'); else void useNavigation.getState().openRecent(chosen); }}>Open editor</button>}{error && <Notice danger>{error}</Notice>}</section>
    <section className="home-start"><div><h2>Bring your footage.</h2><p>Open an edit, or create a project from a folder.</p></div><ProjectActions /><BrowseMediaButton /></section><div className="home-details"><section><div className="section-heading"><h2>Recent runs</h2><span className="quiet">Not available in this build</span></div><p className="field-note">Manual editing and the assistant are available in your project's Editor.</p></section><section><div className="section-heading"><h2>Connections</h2><span className="quiet">API-equivalent estimate</span></div><dl className="usage-list"><div><dt>Claude</dt><dd>{claude?.status === 'connected' ? accountMethodLabel(claude) : accountsError ?? 'Not connected'}</dd></div><div><dt>ElevenLabs</dt><dd>{elevenlabs?.status === 'connected' ? elevenlabs.detail ?? 'Connected · Balance unavailable' : 'Not connected'}</dd></div></dl></section></div></div>;
}
