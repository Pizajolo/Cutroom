import { useState } from 'react';
import type { VideoSkill, VideoSkillDetail } from '@shared/schema/skills';
import { Dialog } from '../components/Dialog';
import { Notice } from '../components/Notice';
import { api } from '../lib/api';
import { useSkills } from '../lib/useSkills';
import { errorMessage, useNavigation } from '../state/navigation';
import { useAssistant } from '../editor/assistantStore';

export function focusChat() {
  const s = useNavigation.getState();
  if (!s.project) { s.focusGoal(); return; }
  useNavigation.setState({ destination: 'project', chatCollapsed: false, chatFocusRequest: s.chatFocusRequest + 1 });
}
export function SaveSkillDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const error = useAssistant((s) => s.error);
  const send = async () => {
    setBusy(true); focusChat();
    if (await useAssistant.getState().send(`Turn the current edit into a reusable video skill via skill_save. Name: ${JSON.stringify(name.trim())}. Description: ${JSON.stringify(description.trim())}. Extract structure and style without this project's text or file paths. Ask me to confirm the skill before saving.`, 'edit')) onClose();
    setBusy(false);
  };
  return <Dialog className="skill-small-dialog" title="Save this edit as a skill" onClose={onClose} footer={<><button className="button" autoFocus onClick={onClose}>Cancel</button><button className="button primary" disabled={!name.trim() || busy} onClick={() => void send()}>{busy ? 'Preparing reusable instructions…' : 'Continue in chat'}</button></>}><p className="field-note">Claude will extract reusable structure and style, without this project's text or file paths.</p><label className="form-field">Name<input maxLength={200} value={name} onChange={(e) => setName(e.target.value)} /></label><label className="form-field">Description<textarea maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} /></label>{error && <Notice danger>{error}</Notice>}</Dialog>;
}
export function Skills() {
  const { data, error, retry } = useSkills();
  const project = useNavigation((s) => s.project);
  const recents = useNavigation((s) => s.recentProjects);
  const [save, setSave] = useState(false);
  const [edit, setEdit] = useState<VideoSkillDetail | null>(null);
  const [deleting, setDeleting] = useState<VideoSkill | null>(null);
  const [choose, setChoose] = useState<VideoSkill | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const run = async (action: () => Promise<void>) => { setBusy(true); setFailure(''); try { await action(); } catch (r) { setFailure(errorMessage(r)); } finally { setBusy(false); } };
  const selectSkill = (skill: VideoSkill) => { useAssistant.setState({ skillId: skill.id }); setChoose(null); focusChat(); };
  return <div className="page skills-page" data-workspace-region tabIndex={-1}><div className="page-heading"><div><h1>Skills</h1><p className="settings-intro">Reusable video types for any project.</p></div><button className="button" disabled={!project} onClick={() => setSave(true)}>Save this edit as a skill</button></div>{!project && <p className="field-note">Open a project to save its edit.</p>}{error && <Notice danger action={<button className="button" onClick={retry}>Retry</button>}>{error}</Notice>}{failure && <Notice danger>{failure}</Notice>}{!data && !error && <p role="status">Loading skills…</p>}<div className="skills-grid">{data?.map((skill) => <article className="skill-card" key={skill.id}><header><h2>{skill.name}</h2><span className="source-pill">{skill.source === 'builtin' ? 'Built-in' : 'Yours'}</span></header><p>{skill.description}</p><div className="form-row"><button className="button" onClick={() => project ? selectSkill(skill) : setChoose(skill)}>Use in project</button>{skill.source === 'user' && <><button className="button quiet-button" disabled={busy} onClick={() => void run(async () => setEdit(await api.invoke('skills.get', { id: skill.id })))}>Edit</button><button className="button quiet-button" onClick={() => setDeleting(skill)}>Delete</button></>}</div></article>)}</div>{data && !data.some((s) => s.source === 'user') && <p className="settings-intro">Your saved video types will appear here. Open a project to save its structure and style.</p>}
    {edit && <Dialog className="skill-edit-dialog" title="Edit skill" onClose={() => setEdit(null)} footer={<><button className="button" onClick={() => setEdit(null)}>Cancel</button><button className="button primary" disabled={busy || !edit.name.trim() || !edit.instructions.trim()} onClick={() => void run(async () => { await api.invoke('skills.save', { id: edit.id, name: edit.name, description: edit.description, instructions: edit.instructions }); setEdit(null); retry(); })}>Save changes</button></>}><label className="form-field">Name<input maxLength={200} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label><label className="form-field">Description<textarea maxLength={2000} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></label><label className="form-field">Instructions<textarea rows={12} maxLength={100000} value={edit.instructions} onChange={(e) => setEdit({ ...edit, instructions: e.target.value })} /></label>{failure && <Notice danger>{failure}</Notice>}</Dialog>}
    {deleting && <Dialog className="skill-small-dialog" title={`Delete ${deleting.name}?`} onClose={() => setDeleting(null)} footer={<><button className="button" autoFocus onClick={() => setDeleting(null)}>Cancel</button><button className="button danger" disabled={busy} onClick={() => void run(async () => { await api.invoke('skills.delete', { id: deleting.id }); setDeleting(null); retry(); })}>Delete skill</button></>}><p>Projects already made with this skill won't change.</p>{failure && <Notice danger>{failure}</Notice>}</Dialog>}
    {choose && <Dialog title="Choose a project" onClose={() => setChoose(null)}><ul className="recent-list">{recents.map((recent) => <li key={recent.id}><button className="button" disabled={recent.missing || busy} onClick={() => void run(async () => { await useNavigation.getState().openRecent(recent.id); if (useNavigation.getState().project?.project.id !== recent.id) throw new Error(useNavigation.getState().projectError ?? 'Project could not be opened.'); selectSkill(choose); })}>{recent.name}</button></li>)}</ul><div className="form-row"><button className="button" onClick={() => { useAssistant.setState({ skillId: choose.id }); setChoose(null); useNavigation.getState().newProject(); }}>New project…</button><button className="button" onClick={() => void run(async () => { await useNavigation.getState().pickProject(); if (useNavigation.getState().project) selectSkill(choose); })}>Open project…</button></div>{failure && <Notice danger>{failure}</Notice>}</Dialog>}
    {save && <SaveSkillDialog onClose={() => setSave(false)} />}
  </div>;
}
