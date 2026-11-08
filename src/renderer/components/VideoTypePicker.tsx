import { useState } from 'react';
import { X } from 'lucide-react';
import { Dialog } from './Dialog';
import { Notice } from './Notice';
import { useSkills } from '../lib/useSkills';
import { useAssistant } from '../editor/assistantStore';

export function VideoTypePicker() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const { data, error, retry } = useSkills();
  const skillId = useAssistant((s) => s.skillId);
  const selected = data?.find((s) => s.id === skillId);
  return <><span className="video-type-chip"><button className="button" onClick={() => setOpen(true)}>{selected?.name ?? 'Video type'}</button>{skillId && <button className="icon-button" aria-label="Remove video type" onClick={() => useAssistant.setState({ skillId: null })}><X size={14} /></button>}</span>
    {open && <Dialog className="video-type-dialog" title="Video type" onClose={() => setOpen(false)}><label className="form-field">Search video types<input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} /></label>{error && <Notice danger action={<button className="button" onClick={retry}>Retry</button>}>{error}</Notice>}<div className="skill-picker" onKeyDown={(e) => { const rows = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button')]; const index = rows.indexOf(document.activeElement as HTMLButtonElement); if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) { e.preventDefault(); rows[e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length]?.focus(); } }}>{(['builtin', 'user'] as const).map((source) => <section key={source}><h3>{source === 'builtin' ? 'Built-in' : 'Yours'}</h3>{data?.filter((s) => s.source === source && `${s.name} ${s.description}`.toLowerCase().includes(query.toLowerCase())).map((skill) => <button className="skill-picker-row" key={skill.id} aria-pressed={skill.id === skillId} onClick={() => { useAssistant.setState({ skillId: skill.id }); setOpen(false); }}><strong>{skill.name}</strong><span>{skill.description}</span></button>)}</section>)}{data && !data.some((s) => `${s.name} ${s.description}`.toLowerCase().includes(query.toLowerCase())) && <p className="field-note">No matching video types.</p>}{!data && !error && <p role="status">Loading video types…</p>}</div></Dialog>}
  </>;
}
