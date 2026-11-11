import { useEffect, useState } from 'react';
import { FolderOpen, Play, Trash2 } from 'lucide-react';
import type { Skill } from '../shared/types';
import { UTILITY_SKILLS } from '../shared/types';
import { api } from './lib';

/** `/Users/me/Videos/trip/exports/trip-01.mp4` → `trip / trip-01.mp4` */
const videoLabel = (file: string): string => {
  const parts = file.split('/');
  return `${parts.at(-3)} / ${parts.at(-1)}`;
};

/** One opened style: the video it came from, the videos made with it since, and its instructions. */
function StyleDetail({ skill, onChange }: { skill: Skill; onChange: (skills: Skill[]) => void }) {
  const [text, setText] = useState<string | null>(null);
  const [saved, setSaved] = useState('');
  useEffect(() => void api.readSkill(skill.id).then((t) => (setText(t), setSaved(t))), [skill.id]);

  return (
    <div className="style-detail">
      {skill.example && <video src={skill.example} controls muted preload="metadata" title="The video this style was saved from" />}
      <div className="fields">
        {skill.videos.length > 0 && <span className="hint">Videos made with this style</span>}
        {skill.videos.map((file) => (
          <button key={file} className="ghost" title={file} onClick={() => void api.openVideo(file)}><Play size={14} /> {videoLabel(file)}</button>
        ))}
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
    </div>
  );
}

/** The style library: browse, watch the videos behind a style, edit your own. */
export function Styles() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [open, setOpen] = useState('');
  useEffect(() => void api.listSkills().then(setSkills), []);

  const remove = (skill: Skill): void => {
    if (confirm(`Move the style “${skill.name}” to the Trash?`)) void api.deleteSkill(skill.id).then(setSkills);
  };

  return (
    <>
      <h1>Styles</h1>
      <p className="hint">
        Styles are skills Claude follows when editing. To add your own, finish an edit you like and press “Save style” in the chat.
        Click a style to see its videos and instructions.
      </p>
      <ul className="list">
        {skills.filter((skill) => !UTILITY_SKILLS.includes(skill.id)).map((skill) => (
          <li key={skill.id}>
            <button className="ghost grow tall" aria-expanded={open === skill.id} onClick={() => setOpen(open === skill.id ? '' : skill.id)}>
              <strong>{skill.name}</strong> <span className="tag">{skill.custom ? 'Yours' : 'Built-in'}</span>
              {skill.videos.length > 0 && <span className="tag">{skill.videos.length} video{skill.videos.length > 1 ? 's' : ''}</span>}
              <span className="description">{skill.description}</span>
            </button>
            {skill.custom && <button className="ghost" title="Move to Trash" onClick={() => remove(skill)}><Trash2 size={14} /></button>}
            {open === skill.id && <StyleDetail skill={skill} onChange={setSkills} />}
          </li>
        ))}
      </ul>
    </>
  );
}
