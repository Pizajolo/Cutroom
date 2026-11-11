import { useEffect, useState } from 'react';
import { FolderOpen, Star, Trash2, X } from 'lucide-react';
import type { Example, Skill } from '../shared/types';
import { useLibraryFilter } from './LibraryFilter';
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
          <span className="tag">{skill.kind === 'move' ? 'Move' : 'Style'}</span>
          <span className="tag">{tagOf(skill)}</span>
          {skill.tags.map((tag) => <span key={tag} className="tag">{tag}</span>)}
          <span className="spacer" />
          <button className={skill.favorite ? 'ghost favorite' : 'ghost'} aria-pressed={skill.favorite} title={skill.favorite ? 'Remove from favourites' : 'Add to favourites'} onClick={() => void api.toggleFavorite(skill.id).then(onChange)}><Star size={16} /></button>
          <button className="ghost" aria-label="Close" onClick={onClose}><X size={16} /></button>
        </header>
        <p className="description">{skill.description}{skill.source ? ` Learned from ${skill.source}.` : ''}</p>
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

/** The library of styles (whole videos) and moves (single techniques): filter, watch the examples, edit your own. */
export function Styles() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [open, setOpen] = useState('');
  useEffect(() => void api.listSkills().then(setSkills), []);
  const [visible, filter] = useLibraryFilter(skills);
  const opened = skills.find((skill) => skill.id === open);

  const remove = (skill: Skill): void => {
    if (confirm(`Move “${skill.name}” to the Trash?`)) void api.deleteSkill(skill.id).then(setSkills);
  };

  return (
    <>
      <h1>Library</h1>
      <p className="hint">
        A style is how a whole video is made; a move is one technique — a caption treatment, a transition, a title — you can use in any video.
        To add your own, finish an edit you like and press “Save style” in the chat, or mark a section and ask Claude to save it as a move.
      </p>
      {filter}
      <ul className="list">
        {visible.length === 0 && <li className="hint">Nothing matches.</li>}
        {visible.map((skill) => (
          <li key={skill.id}>
            <button className="ghost grow tall" onClick={() => setOpen(skill.id)}>
              <strong>{skill.name}</strong> <span className="tag">{skill.kind === 'move' ? 'Move' : 'Style'}</span> <span className="tag">{tagOf(skill)}</span>
              {skill.examples.length > 0 && <span className="tag">{skill.examples.length} example{skill.examples.length > 1 ? 's' : ''}</span>}
              <span className="description">{skill.description}</span>
              {skill.tags.length > 0 && <span className="description faint">{skill.tags.join(' · ')}</span>}
            </button>
            <button className={skill.favorite ? 'ghost favorite' : 'ghost'} aria-pressed={skill.favorite} title={skill.favorite ? 'Remove from favourites' : 'Favourite: listed first when you pick styles and moves in a project'} onClick={() => void api.toggleFavorite(skill.id).then(setSkills)}>
              <Star size={14} />
            </button>
            {skill.custom && <button className="ghost" title="Move to Trash" onClick={() => remove(skill)}><Trash2 size={14} /></button>}
          </li>
        ))}
      </ul>
      {opened && <StyleDialog key={opened.id} skill={opened} onChange={setSkills} onClose={() => setOpen('')} />}
    </>
  );
}
