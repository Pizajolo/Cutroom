import { useEffect, useState } from 'react';
import { FolderOpen, X } from 'lucide-react';
import type { Project } from '../shared/types';
import { Features } from './Features';
import { Settings } from './Settings';
import { Styles } from './Styles';
import { api } from './lib';

type Tab = 'Projects' | 'Styles' | 'Features' | 'Settings';

/** The start page: pick a project, look after the style library, connect accounts. */
export function Home({ onOpen, children }: { onOpen: (project: Project | null) => void; children?: React.ReactNode }) {
  const [tab, setTab] = useState<Tab>('Projects');
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => void api.recentProjects().then(setProjects), []);

  return (
    <main className="home">
      <header>
        <strong>Cutroom</strong>
        <div className="switch" role="tablist">
          {(['Projects', 'Styles', 'Features', 'Settings'] as const).map((name) => (
            <button key={name} role="tab" aria-selected={tab === name} onClick={() => setTab(name)}>{name}</button>
          ))}
        </div>
        <span className="spacer" />
        {children}
      </header>
      <div className="page">
        {tab === 'Projects' && (
          <>
            <div className="row">
              <h1>Projects</h1>
              <span className="spacer" />
              <button className="primary" onClick={() => void api.openProject().then(onOpen)}>
                <FolderOpen size={16} /> Open or create a folder
              </button>
            </div>
            <p className="hint">A project is a folder with your raw footage. Cutroom adds raw, references, assets and exports inside it.</p>
            <ul className="list">
              {projects.map((project) => (
                <li key={project.root}>
                  <button className="ghost grow" onClick={() => void api.openRecent(project.root).then(onOpen)}>
                    <strong>{project.name}</strong> <span className="path">{project.root}</span>
                  </button>
                  <button className="ghost" title="Remove from this list (the folder is not deleted)" onClick={() => void api.forgetProject(project.root).then(setProjects)}>
                    <X size={14} />
                  </button>
                </li>
              ))}
              {projects.length === 0 && <li className="hint">No projects yet.</li>}
            </ul>
          </>
        )}
        {tab === 'Styles' && <Styles />}
        {tab === 'Features' && (
          <>
            <h1>Features</h1>
            <p className="hint">
              Everything Cutroom can do and where it comes from. Switch off what you don’t want Claude to use; connect accounts
              in Settings. Each project can switch features off for itself from its own settings button.
            </p>
            <Features scope="everywhere" />
          </>
        )}
        {tab === 'Settings' && <Settings />}
      </div>
    </main>
  );
}
