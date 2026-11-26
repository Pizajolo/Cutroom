import { useEffect, useState } from 'react';
import {
  BarChart3,
  CircleHelp,
  Folder,
  FolderOpen,
  House,
  LayoutGrid,
  Library,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Settings as SettingsIcon,
  Store,
  TriangleAlert,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { SocialSettings, SocialStatus } from '../shared/social';
import type { Project } from '../shared/types';
import { Brands } from './Brands';
import { Features } from './Features';
import { Dashboard } from './HomeWidgets';
import type { Page } from './HomeWidgets';
import { Market, SkillDialog } from './Market';
import { Settings } from './Settings';
import { Social } from './Social';
import { Styles } from './Styles';
import { api } from './lib';

const NAV: { page: Page; icon: LucideIcon }[] = [
  { page: 'Home', icon: House },
  { page: 'Projects', icon: Folder },
  { page: 'Social', icon: BarChart3 },
  { page: 'Library', icon: Library },
  { page: 'Brand kits', icon: Palette },
  { page: 'Marketplace', icon: Store },
  { page: 'Features', icon: LayoutGrid },
];

const stored = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const store = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Only a convenience.
  }
};

/** Follows a media query, e.g. whether the window is narrow. */
function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const list = matchMedia(query);
    const update = (): void => setMatches(list.matches);
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}

/** Everything outside a project: a sidebar to move between pages, and the page. */
export function Home({
  onOpen,
  onGuide,
  settingsKey,
  notice,
}: {
  onOpen: (project: Project | null) => void;
  onGuide: () => void;
  /** Changes when settings were saved elsewhere (the guide), so the Settings page reloads them. */
  settingsKey?: number;
  /** Tools that are missing or installing. */
  notice?: { text: string; detail: string };
}) {
  const [page, setPage] = useState<Page>(() => (stored('home-page') as Page | null) ?? 'Home');
  const [folded, setFolded] = useState(() => stored('sidebar') === 'icons');
  const narrow = useMedia('(max-width: 860px)');
  const iconsOnly = folded || narrow;
  const [projects, setProjects] = useState<Project[]>([]);
  const [social, setSocial] = useState<SocialStatus | null>(null);
  const [rules, setRules] = useState<SocialSettings | null>(null);
  const [marketSlug, setMarketSlug] = useState('');

  useEffect(() => {
    void api.recentProjects().then(setProjects);
    void api.socialStatus().then(setSocial, () => {});
    void api.getSettings().then(
      (s) => setRules(s.social),
      () => {},
    );
    return api.on('social', setSocial);
  }, []);
  // Rules (handles) may have changed on the Social page.
  useEffect(() => {
    if (page === 'Home')
      void api.getSettings().then(
        (s) => setRules(s.social),
        () => {},
      );
  }, [page]);

  const go = (next: Page): void => {
    setPage(next);
    store('home-page', next);
  };
  const fold = (on: boolean): void => {
    setFolded(on);
    store('sidebar', on ? 'icons' : 'full');
  };
  const newProject = (): void => void api.openProject().then(onOpen);
  const drafts =
    social?.drafts.filter((d) => d.status === 'draft' || d.status === 'waiting').length ?? 0;

  const link = (
    label: string,
    Icon: LucideIcon,
    active: boolean,
    onClick: () => void,
    badge?: number,
  ) => (
    <button
      key={label}
      className={active ? 'nav-item active' : 'nav-item'}
      aria-current={active ? 'page' : undefined}
      title={iconsOnly ? (badge ? `${label} · ${badge} waiting` : label) : undefined}
      aria-label={iconsOnly ? label : undefined}
      onClick={onClick}
    >
      <Icon size={16} />
      <span className="nav-label">{label}</span>
      {badge ? (
        <span className="badge-count" aria-label={`${badge} drafts ready to post`}>
          {badge}
        </span>
      ) : null}
    </button>
  );

  return (
    <div className={iconsOnly ? 'shell icons' : 'shell'}>
      <nav className="sidebar" aria-label="Cutroom">
        {/* The window buttons sit alone in the top strip, so nothing below moves when the sidebar folds. */}
        <div className="sidebar-top" />
        {!narrow && (
          <div className="sidebar-brand">
            <button
              className="ghost fold"
              title={folded ? 'Show names' : 'Icons only'}
              aria-label={folded ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-expanded={!folded}
              onClick={() => fold(!folded)}
            >
              {folded ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
            <strong className="brand">Cutroom</strong>
          </div>
        )}
        <div className="nav-items">
          {NAV.map(({ page: p, icon }) =>
            link(p, icon, page === p, () => go(p), p === 'Social' ? drafts : undefined),
          )}
          <span className="spacer" />
          {notice && (
            <span className="nav-item notice" title={notice.detail} aria-label={notice.text}>
              <TriangleAlert size={16} />
              <span className="nav-label">{notice.text}</span>
            </span>
          )}
          {link('Guide', CircleHelp, false, onGuide)}
          {link('Settings', SettingsIcon, page === 'Settings', () => go('Settings'))}
        </div>
      </nav>

      <div className="main">
        <div className="drag-strip" />
        <main className="page">
          {page === 'Home' && (
            <Dashboard
              projects={projects}
              social={social}
              rules={rules}
              onOpenProject={(p) => void api.openRecent(p.root).then(onOpen)}
              onNewProject={newProject}
              onGo={go}
              onGuide={onGuide}
              onMarket={setMarketSlug}
            />
          )}
          {page === 'Projects' && (
            <>
              <div className="row page-title">
                <h1>Projects</h1>
                <span className="spacer" />
                <button className="primary" onClick={newProject}>
                  <FolderOpen size={14} /> Open or create a folder
                </button>
              </div>
              <p className="hint">
                A project is a folder with your raw footage. Cutroom adds raw, references, assets
                and exports inside it.
              </p>
              <ul className="list">
                {projects.map((project) => (
                  <li key={project.root}>
                    <button
                      className="ghost grow"
                      onClick={() => void api.openRecent(project.root).then(onOpen)}
                    >
                      <strong>{project.name}</strong> <span className="path">{project.root}</span>
                    </button>
                    <button
                      className="ghost"
                      title="Remove from this list (the folder is not deleted)"
                      onClick={() => void api.forgetProject(project.root).then(setProjects)}
                    >
                      <X size={14} />
                    </button>
                  </li>
                ))}
                {projects.length === 0 && <li className="hint">No projects yet.</li>}
              </ul>
            </>
          )}
          {page === 'Library' && <Styles />}
          {page === 'Brand kits' && <Brands />}
          {page === 'Marketplace' && <Market />}
          {page === 'Social' && <Social />}
          {page === 'Features' && (
            <>
              <h1>Features</h1>
              <p className="hint">
                Everything Cutroom can do and where it comes from. Switch off what you don’t want
                Claude to use; connect accounts in Settings. Each project can switch features off
                for itself from its own settings button.
              </p>
              <Features scope="everywhere" />
            </>
          )}
          {page === 'Settings' && <Settings key={settingsKey} />}
        </main>
      </div>
      {marketSlug && (
        <SkillDialog key={marketSlug} slug={marketSlug} onClose={() => setMarketSlug('')} />
      )}
    </div>
  );
}
