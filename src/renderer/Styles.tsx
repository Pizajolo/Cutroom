import { useEffect, useState } from 'react';
import { FolderOpen, Trash2, X } from 'lucide-react';
import type { Example, Skill } from '../shared/types';
import { UTILITY_SKILLS } from '../shared/types';
import { api } from './lib';

const tagOf = (skill: Skill): string => (skill.custom ? 'Yours' : 'Built-in');

/** One style in a popup: the videos that show it, and its instructions. */
function StyleDialog({ skill, onChange, onClose }: { skill: Skill; onChange: (skills: Skill[]) => void; onClose: () => void }) {
  const [tab, setTab] = useState<'Examples' | 'Skill'>(skill.examples.length ? 'Examples' : 'Skill');
  const [text, setText] = useState<string | null>(null);
  const [saved, setSaved] = useState('');
  useEffect(() => void api.readSkill(skill.id).then((t) => (setText(t), setSaved(t))), [skill.id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => void (e.key === 'Escape' && onClose());
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const remove = (example: Example): void => {
    const saved = example.file.endsWith('/example.mp4') && skill.custom;
    const question = saved ? 'Remove this example? The saved video goes to the Trash.' : 'Remove this example? The exported video itself is kept.';
    if (confirm(question)) void api.removeExample(skill.id, example.file).then(onChange);
  };

  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section role="dialog" aria-label={skill.name}>
        <header>
          <h2>{skill.name}</h2>
          <span className="tag">{tagOf(skill)}</span>
          <span className="spacer" />
          <button className="ghost" aria-label="Close" onClick={onClose}><X size={16} /></button>
        </header>
        <p className="description">{skill.description}</p>
        <div className="switch" role="tablist">
          {(['Examples', 'Skill'] as const).map((name) => (
            <button key={name} role="tab" aria-selected={tab === name} onClick={() => setTab(name)}>
              {name}{name === 'Examples' && skill.examples.length > 0 ? ` (${skill.examples.length})` : ''}
            </button>
          ))}
        </div>
        {tab === 'Examples' ? (
          <div className="body">
            {skill.examples.length === 0 && <p className="hint">No examples yet. Videos you export with this style appear here.</p>}
            <div className="examples">
              {skill.examples.map((example) => (
                <figure key={example.file}>
                  <video src={example.src} controls preload="metadata" />
                  <figcaption>
                    <span title={example.file}>{example.label}</span>
                    <button className="ghost" title="Remove this example" onClick={() => remove(example)}><Trash2 size={14} /></button>
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        ) : (
          <div className="body">
            <textarea value={text ?? ''} readOnly={!skill.custom} spellCheck={false} aria-label="Style instructions" onChange={(e) => setText(e.target.value)} />
            <div className="row">
              {skill.custom ? (
                <button className="primary" disabled={text === saved} onClick={() => void api.saveSkill(skill.id, text!).then((all) => (setSaved(text!), onChange(all)))}>
                  {text === saved ? 'Saved' : 'Save changes'}
                </button>
              ) : (
                <span className="hint">Built-in styles can’t be changed. Save your own from an edit you like.</span>
              )}
              <button className="ghost" onClick={() => void api.revealSkill(skill.id)}><FolderOpen size={14} /> Show in Finder</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

/** The style library: browse, watch the videos made with a style, edit your own. */
export function Styles() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [open, setOpen] = useState('');
  useEffect(() => void api.listSkills().then(setSkills), []);
  const opened = skills.find((skill) => skill.id === open);

  const remove = (skill: Skill): void => {
    if (confirm(`Move the style “${skill.name}” to the Trash?`)) void api.deleteSkill(skill.id).then(setSkills);
  };

  return (
    <>
      <h1>Styles</h1>
      <p className="hint">
        Styles are skills Claude follows when editing. To add your own, finish an edit you like and press “Save style” in the chat.
        Click a style to see its example videos and instructions.
      </p>
      <ul className="list">
        {skills.filter((skill) => !UTILITY_SKILLS.includes(skill.id)).map((skill) => (
          <li key={skill.id}>
            <button className="ghost grow tall" onClick={() => setOpen(skill.id)}>
              <strong>{skill.name}</strong> <span className="tag">{tagOf(skill)}</span>
              {skill.examples.length > 0 && <span className="tag">{skill.examples.length} example{skill.examples.length > 1 ? 's' : ''}</span>}
              <span className="description">{skill.description}</span>
            </button>
            {skill.custom && <button className="ghost" title="Move to Trash" onClick={() => remove(skill)}><Trash2 size={14} /></button>}
          </li>
        ))}
      </ul>
      {opened && <StyleDialog key={opened.id} skill={opened} onChange={setSkills} onClose={() => setOpen('')} />}
    </>
  );
}
