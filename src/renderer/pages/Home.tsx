import { useEffect, useRef } from 'react';
import { ArrowUp, FolderOpen, Mic, Paperclip, Plus } from 'lucide-react';
import { useNavigation } from '../state/navigation';
import { BrowseMediaButton } from '../media/MediaBrowser';

export function ProjectActions() {
  return <div className="project-actions" aria-describedby="project-service-note">
    <button type="button" className="button" disabled><FolderOpen size={16} />Open project</button>
    <button type="button" className="button primary" disabled><Plus size={16} />New project</button>
    <BrowseMediaButton />
  </div>;
}

export function Home() {
  const draft = useNavigation((state) => state.goalDraft);
  const setDraft = useNavigation((state) => state.setGoalDraft);
  const focusRequest = useNavigation((state) => state.goalFocusRequest);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (focusRequest > 0) ref.current?.focus(); }, [focusRequest]);
  return <div className="page home-page" data-workspace-region tabIndex={-1}>
    <div className="page-heading"><h1>What do you want to make?</h1></div>
    <section className="goal-section" aria-label="New goal">
      <label htmlFor="home-goal" className="sr-only">Describe your video</label>
      <div className="goal-composer">
        <textarea id="home-goal" ref={ref} value={draft} onChange={(event) => setDraft(event.target.value)}
          placeholder="Cut a 60-second teaser from my footage, with animated titles and a voiceover…" />
        <div className="composer-toolbar">
          <button type="button" className="icon-button" aria-label="Attach files unavailable" title="Attachments are not connected in this build" disabled><Paperclip size={16} /></button>
          <button type="button" className="icon-button" aria-label="Voice input unavailable" title="Voice input is not connected in this build" disabled><Mic size={16} /></button>
          <span className="composer-hint">New goal <kbd>⌘N</kbd></span>
          <button type="button" className="button primary" disabled aria-describedby="goal-service-note"><ArrowUp size={16} />Start</button>
        </div>
      </div>
      <p id="goal-service-note" className="field-note">Your draft stays here while you explore. Starting a team isn't connected in this build.</p>
    </section>
    <section className="home-start" aria-labelledby="home-projects-title">
      <div><h2 id="home-projects-title">Make a video with your team.</h2><p>Bring in a folder of footage, or start with an idea.</p></div>
      <ProjectActions />
      <p className="field-note" id="project-service-note">Opening and creating project folders isn't connected in this build.</p>
    </section>
    <div className="home-details">
      <section aria-labelledby="recent-runs-title"><div className="section-heading"><h2 id="recent-runs-title">Recent runs</h2><span className="quiet">Not connected</span></div><div className="home-empty"><p>Your team's work will appear here.</p><p className="quiet">No runs are loaded in this build.</p></div></section>
      <section aria-labelledby="usage-title"><div className="section-heading"><h2 id="usage-title">Usage</h2><span className="quiet">API-equivalent estimate</span></div>
        <dl className="usage-list"><div><dt>Today</dt><dd>Unavailable</dd></div><div><dt>This week</dt><dd>Unavailable</dd></div><div><dt>Claude plan</dt><dd>Not connected</dd></div><div><dt>ElevenLabs credits</dt><dd>Not connected</dd></div></dl>
        <p className="field-note">Usage appears only when the connected account provides it.</p>
      </section>
    </div>
  </div>;
}
