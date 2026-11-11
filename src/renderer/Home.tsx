import { useEffect, useState } from 'react';
import { FolderOpen, Trash2, X } from 'lucide-react';
import type { Project, Skill } from '../shared/types';
import { Features } from './Features';
import { Settings } from './Settings';
import { api } from './lib';

type Tab = 'Projects' | 'Styles' | 'Features' | 'Settings';

/** The start page: pick a project, look after the style library, connect accounts. */
export function Home({ onOpen, children }: { onOpen: (project: Project | null) => void; children?: React.ReactNode }) {
  const [tab, setTab] = useState<Tab>('Projects');
  const [projects, setProjects] = useState<Project[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);

  useEffect(() => {
    void api.recentProjects().then(setProjects);
    void api.listSkills().then(setSkills);
  }, []);

  const deleteSkill = (skill: Skill): void => {
    if (confirm(`Move the style “${skill.name}” to the Trash?`)) void api.deleteSkill(skill.id).then(setSkills);
  };

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
        {tab === 'Styles' && (
          <>
            <h1>Styles</h1>
            <p className="hint">Styles are skills Claude follows when editing. To add your own, finish an edit you like and press “Save style” in the chat.</p>
            <ul className="list">
              {skills.map((skill) => (
                <li key={skill.id}>
                  <button className="ghost grow tall" title="Show the skill file in Finder" onClick={() => void api.revealSkill(skill.id)}>
                    <strong>{skill.name}</strong> <span className="tag">{skill.custom ? 'Yours' : 'Built-in'}</span>
                    <span className="description">{skill.description}</span>
                  </button>
                  {skill.custom && (
                    <button className="ghost" title="Move to Trash" onClick={() => deleteSkill(skill)}><Trash2 size={14} /></button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
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
