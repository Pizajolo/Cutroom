import { useEffect, useState } from 'react';
import { Film, FolderOpen, Keyboard, Redo2, Undo2, Upload } from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { Tabs } from './components/Tabs';
import { Dialog } from './components/Dialog';
import { Notice, Unavailable } from './components/Notice';
import { EditorWorkspace } from './editor/EditorWorkspace';
import { previewClock } from './editor/preview/store';
import { useSelection } from './editor/selection/store';
import { keymap, type Shortcut } from './lib/keymap';
import { useAppInfo } from './lib/useAppInfo';
import { Home, ProjectActions } from './pages/Home';
import { Tools } from './pages/Tools';
import { Accounts } from './pages/Accounts';
import { MediaBrowser } from './media/MediaBrowser';
import { PROJECT_TABS, SETTINGS_SECTIONS, useNavigation } from './state/navigation';

function cycleRegion(direction: number) {
  const regions = [...document.querySelectorAll<HTMLElement>('[data-workspace-region]')].filter((element) => element.getClientRects().length > 0);
  const index = regions.findIndex((element) => element === document.activeElement || element.contains(document.activeElement));
  regions[(index + direction + regions.length) % regions.length]?.focus();
}

function Projects() {
  const recent = useNavigation((state) => state.recentProjects);
  const open = useNavigation((state) => state.openProject);
  return <div className="page" data-workspace-region tabIndex={-1}><div className="page-heading"><h1>Projects</h1><ProjectActions /></div>
    <p className="field-note" id="project-service-note">Opening and creating project folders isn't connected in this build.</p>
    {recent.length ? <ul className="project-list">{recent.map((entry) => <li key={entry.project.id}><button type="button" onClick={() => open(entry)}>
      <FolderOpen size={24} strokeWidth={1.5} /><span><strong>{entry.project.name}</strong><small>{entry.rootPath}</small></span><span className="quiet">{entry.project.format.aspect} · {entry.project.format.fps} fps</span>
    </button></li>)}</ul> : <Unavailable title="No recent projects loaded">Open a project folder to keep your footage, edit and exports together. The project service must be connected before folders can be opened.</Unavailable>}
  </div>;
}

function Settings() {
  const section = useNavigation((state) => state.settingsSection);
  const setSection = useNavigation((state) => state.setSettingsSection);
  return <div className="settings-page"><nav className="settings-nav" aria-label="Settings sections"><h1>Settings</h1>{SETTINGS_SECTIONS.map((name) => <button type="button" key={name} aria-current={section === name ? 'page' : undefined} onClick={() => setSection(name)}>{name}</button>)}</nav>
    <div key={section} className="settings-content" data-workspace-region tabIndex={-1}><h2>{section}</h2>
      {section === 'Accounts' ? <Accounts /> : section === 'Tools' ? <Tools /> : <Unavailable title={`${section} not connected`}>
        {`The ${section.toLowerCase()} service is not available in this build. No settings have been changed.`}
      </Unavailable>}
    </div>
  </div>;
}

function ProjectView() {
  const project = useNavigation((state) => state.project);
  const tab = useNavigation((state) => state.tab);
  const setTab = useNavigation((state) => state.setTab);
  if (!project) return <Unavailable title="Open a project first">Your edit, media and team runs stay together in a project folder.</Unavailable>;
  return <Tabs label="Project" tabs={PROJECT_TABS} value={tab} onChange={setTab} className="project-layout">
    {tab === 'Editor' ? <EditorWorkspace project={project.project} /> : <Unavailable title={`${tab} not connected`}>
      {tab === 'Runs' ? 'Team runs and their reports will appear here.' : tab === 'Media' ? 'Browse Footage, References, Assets, Generated audio and Exports here when the media service is connected.' : tab === 'Backlog' ? 'Queue your next video goals here. Backlog management is not connected in this build.' : 'Shared project notes, their history and agent proposals will appear here.'}
    </Unavailable>}
  </Tabs>;
}

export function App() {
  const { info, error, retry } = useAppInfo();
  const destination = useNavigation((state) => state.destination);
  const project = useNavigation((state) => state.project);
  const mediaFolder = useNavigation((state) => state.mediaFolder);
  const collapsed = useNavigation((state) => state.sidebarCollapsed);
  const tab = useNavigation((state) => state.tab);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  useEffect(() => {
    const get = useNavigation.getState;
    const bindings: Shortcut[] = [
      { id: 'new-goal', key: 'n', command: true, scope: 'global', run: () => get().focusGoal() },
      { id: 'settings', key: ',', command: true, scope: 'global', run: () => get().navigate('settings') },
      { id: 'sidebar', key: 'b', command: true, scope: 'global', allowInTextInput: false, run: () => get().toggleSidebar() },
      { id: 'region-next', key: 'F6', scope: 'global', allowInTextInput: false, run: () => cycleRegion(1) },
      { id: 'region-previous', key: 'F6', shift: true, scope: 'global', allowInTextInput: false, run: () => cycleRegion(-1) },
      { id: 'help', key: '?', command: true, shift: true, scope: 'global', run: () => setShortcutsOpen(true) },
      ...PROJECT_TABS.map((value, index): Shortcut => ({ id: `project-${value}`, key: String(index + 1), command: true, scope: 'global', enabled: () => !!get().project, run: () => get().setTab(value) })),
      { id: 'play', key: ' ', scope: 'editor', enabled: () => previewClock.getSnapshot().duration > 0 && !(document.activeElement instanceof HTMLButtonElement), run: () => previewClock.toggle() },
      { id: 'reverse', key: 'j', scope: 'editor', run: () => previewClock.shuttle(-1) },
      { id: 'pause', key: 'k', scope: 'editor', run: () => previewClock.pause() },
      { id: 'forward', key: 'l', scope: 'editor', run: () => previewClock.shuttle(1) },
      { id: 'frame-back', key: 'ArrowLeft', scope: 'editor', repeat: true, run: () => previewClock.step(-1) },
      { id: 'frame-forward', key: 'ArrowRight', scope: 'editor', repeat: true, run: () => previewClock.step(1) },
      { id: 'frames-back', key: 'ArrowLeft', shift: true, scope: 'editor', repeat: true, run: () => previewClock.step(-10) },
      { id: 'frames-forward', key: 'ArrowRight', shift: true, scope: 'editor', repeat: true, run: () => previewClock.step(10) },
      { id: 'start', key: 'Home', scope: 'editor', run: () => previewClock.seek(0) },
      { id: 'end', key: 'End', scope: 'editor', run: () => previewClock.seek(previewClock.getSnapshot().duration) },
      { id: 'clear-selection', key: 'Escape', scope: 'editor', run: () => useSelection.getState().clear() },
    ];
    const unregister = bindings.map((binding) => keymap.register(binding));
    const detach = keymap.attach();
    return () => { detach(); unregister.forEach((remove) => remove()); previewClock.pause(); };
  }, []);
  useEffect(() => {
    keymap.setScopes(destination === 'project' && tab === 'Editor' ? ['editor'] : []);
    if (destination !== 'project' || tab !== 'Editor') previewClock.pause();
  }, [destination, tab]);
  const title = destination === 'project' ? project?.project.name ?? 'Project' : destination === 'media' ? 'Folder media' : destination === 'home' ? 'Home' : destination === 'projects' ? 'Projects' : destination === 'teams' ? 'Teams' : 'Settings';
  return <div className={`app-shell${collapsed ? ' app-sidebar-collapsed' : ''}`}>
    <Sidebar info={info} />
    <div className="main-shell">
      <header className="titlebar"><div className="breadcrumb"><Film size={16} aria-hidden="true" /><span>Cutroom</span><span className="breadcrumb-divider">/</span><strong>{title}</strong></div>
        {destination === 'project' && <div className="titlebar-actions"><span className="quiet">Not synced</span><button type="button" className="icon-button" aria-label="Undo unavailable" disabled><Undo2 size={16} /></button><button type="button" className="icon-button" aria-label="Redo unavailable" disabled><Redo2 size={16} /></button><button type="button" className="button" disabled>Ask <kbd>⌘K</kbd></button><button type="button" className="button primary" disabled><Upload size={14} />Export</button></div>}
        {destination !== 'project' && <button type="button" className="icon-button" aria-label="Keyboard shortcuts" title="Keyboard shortcuts" onClick={() => setShortcutsOpen(true)}><Keyboard size={16} /></button>}
      </header>
      {error && <Notice danger action={<button type="button" className="button" onClick={retry}>Retry</button>}>{error}</Notice>}
      <main className="main-content" id="main-content">
        {destination === 'home' ? <Home /> : destination === 'projects' ? <Projects /> : destination === 'project' ? <ProjectView /> : destination === 'media' && mediaFolder ? <MediaBrowser key={mediaFolder.id} folder={mediaFolder} /> : destination === 'settings' ? <Settings /> : <Unavailable title="Build your video team">Team templates, member settings and workflow editing are not connected in this build.</Unavailable>}
      </main>
    </div>
    {shortcutsOpen && <Dialog title="Keyboard shortcuts" onClose={() => setShortcutsOpen(false)} footer={<button type="button" className="button" onClick={() => setShortcutsOpen(false)}>Done</button>}>
      <dl className="shortcut-list"><div><dt>New goal</dt><dd><kbd>⌘N</kbd></dd></div><div><dt>Settings</dt><dd><kbd>⌘,</kbd></dd></div><div><dt>Collapse sidebar</dt><dd><kbd>⌘B</kbd></dd></div><div><dt>Project tabs</dt><dd><kbd>⌘1–5</kbd></dd></div><div><dt>Next workspace region</dt><dd><kbd>F6</kbd></dd></div><div><dt>Previous workspace region</dt><dd><kbd>⇧F6</kbd></dd></div></dl>
      <p className="field-note">Editing shortcuts stay inactive in text fields. Project actions need an open project connection.</p>
    </Dialog>}
  </div>;
}
