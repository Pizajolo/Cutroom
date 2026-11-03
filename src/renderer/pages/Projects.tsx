import { useState } from 'react';
import { FolderOpen, Plus } from 'lucide-react';
import type { InvokeRes } from '@shared/ipc';
import { projectNameSchema } from '@shared/schema/project';
import { api } from '../lib/api';
import { Dialog } from '../components/Dialog';
import { Notice } from '../components/Notice';
import { errorMessage, useNavigation } from '../state/navigation';

export function ProjectActions() {
  const busy = useNavigation((s) => s.projectBusy);
  return <div className="project-actions"><button className="button" disabled={busy} onClick={() => { void useNavigation.getState().pickProject(); }}><FolderOpen size={16} />Open project</button><button className="button primary" onClick={() => useNavigation.getState().newProject()}><Plus size={16} />New project</button></div>;
}
export function Projects() {
  const recents = useNavigation((s) => s.recentProjects);
  const loading = useNavigation((s) => s.loadingProjects);
  const busy = useNavigation((s) => s.projectBusy);
  const current = useNavigation((s) => s.project);
  const [error, setError] = useState('');
  return <div className="page" data-workspace-region tabIndex={-1}><div className="page-heading"><div><h1>Projects</h1><p className="field-note">Open a recent edit or create a project from your footage.</p></div><ProjectActions /></div>
    {error && <Notice danger>{error}</Notice>}
    {loading ? <p role="status">Loading projects…</p> : recents.length ? <ul className="recent-list">{recents.map((entry) => <li key={entry.id}><FolderOpen size={28} /><div className="recent-description"><strong>{entry.name}</strong><span className="field-note">{entry.rootPath}</span><span className="field-note">{entry.format.aspect} · {entry.format.width} × {entry.format.height} · {entry.format.fps} fps · {new Date(entry.lastOpenedAt).toLocaleString()}</span>{entry.missing ? <span className="field-error">Folder not found</span> : current?.project.id === entry.id && <small>Open now</small>}</div><button className="button" disabled={entry.missing || busy} onClick={() => { void useNavigation.getState().openRecent(entry.id); }}>Open</button><button className="button quiet-button" onClick={() => { void api.invoke('project.removeRecent', { id: entry.id }).then(() => useNavigation.getState().refreshRecent()).catch((reason: unknown) => setError(errorMessage(reason))); }}>Remove from list</button></li>)}</ul> : <div className="empty-state"><FolderOpen size={32} /><h2>Your edits will appear here.</h2><p>You can open an existing footage folder and create a project without moving its files.</p><ProjectActions /></div>}
  </div>;
}
export function ProjectDialog() {
  const dialog = useNavigation((s) => s.projectDialog);
  return dialog ? <ProjectForm key={typeof dialog === 'string' ? dialog : dialog.grantId} /> : null;
}
function ProjectForm() {
  const dialog = useNavigation.getState().projectDialog;
  const inPlace = dialog && typeof dialog !== 'string' ? dialog : null;
  const [name, setName] = useState(inPlace?.displayPath.split('/').filter(Boolean).pop() ?? '');
  const [parent, setParent] = useState<InvokeRes<'dialog.pickFolder'>>(null);
  const [footage, setFootage] = useState<InvokeRes<'dialog.pickFolder'>>(null);
  const [aspect, setAspect] = useState<'16:9' | '9:16' | '1:1'>('16:9');
  const [resolution, setResolution] = useState('1080');
  const [fps, setFps] = useState<InvokeRes<'project.create'>['project']['format']['fps']>(30);
  const [engine, setEngine] = useState<'hyperframes' | 'remotion'>('hyperframes');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [licence, setLicence] = useState(false);
  const close = () => { if (!busy) useNavigation.setState({ projectDialog: null }); };
  const pick = async (purpose: 'projectParent' | 'footage') => {
    try { const value = await api.invoke('dialog.pickFolder', { purpose }); if (value) (purpose === 'projectParent' ? setParent : setFootage)(value); }
    catch (reason) { setError(errorMessage(reason)); }
  };
  const dimensions: [number, number] = aspect === '16:9' ? [Number(resolution) * 16 / 9, Number(resolution)] : aspect === '9:16' ? [Number(resolution), Number(resolution) * 16 / 9] : [Number(resolution), Number(resolution)];
  const reason = !projectNameSchema.safeParse(name).success ? 'Enter a project name (not a path).' : !inPlace && !parent ? 'Choose a location for this project.' : '';
  const create = async () => {
    if (reason || busy) return;
    setBusy(true); setError('');
    try {
      const request = { name: name.trim(), format: { aspect, width: Math.round(dimensions[0]), height: Math.round(dimensions[1]), fps }, defaultEngine: engine };
      const session = inPlace ? await api.invoke('project.createInPlace', { ...request, grantId: inPlace.grantId }) : await api.invoke('project.create', { ...request, parentGrant: parent!.grantId, ...(footage ? { footageGrant: footage.grantId } : {}) });
      useNavigation.getState().openProject(session);
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  };
  return <><Dialog title={inPlace ? 'Create a project in this folder?' : 'New project'} onClose={close} wide footer={<><span className="field-note">{reason}</span><button className="button" autoFocus={!!inPlace} disabled={busy} onClick={close}>Cancel</button><button className="button primary" disabled={!!reason || busy} onClick={() => { void create(); }}>{busy ? 'Creating…' : inPlace ? 'Create project here' : 'Create project'}</button></>}>
    <form className="settings-form" onSubmit={(event) => { event.preventDefault(); void create(); }}>
      {inPlace && <><p className="literal-path">{inPlace.displayPath}</p><p>Found {inPlace.looseMediaCount} media files in the folder root.</p><p>Cutroom will add project files and its standard folders here. Existing files stay in place.</p><div className="scope-inset"><p>Added: .cutroom/, timeline.json, and missing standard folders.</p><p>Existing files: Kept in place.</p><p>Loose media: Visible in Folder root; not copied automatically.</p></div></>}
      <label className="form-field">Name<input autoFocus={!inPlace} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></label>
      {!inPlace && <div className="form-field"><span>Location</span><div className="form-row"><span className="literal-path">{parent?.displayPath ?? 'No location selected'}</span><button type="button" className="button" disabled={busy} onClick={() => { void pick('projectParent'); }}>Choose location</button></div><small>Creates a new folder here. Existing folders won't be overwritten.</small></div>}
      <div className="form-row"><label className="form-field">Aspect<select value={aspect} onChange={(e) => setAspect(e.target.value as typeof aspect)}>{['16:9', '9:16', '1:1'].map((v) => <option key={v}>{v}</option>)}</select></label><label className="form-field">Resolution<select value={resolution} onChange={(e) => setResolution(e.target.value)}><option value="1080">1080p</option><option value="720">720p</option><option value="2160">2160p</option></select></label><label className="form-field">Frame rate<select value={fps} onChange={(e) => setFps(Number(e.target.value) as typeof fps)}>{[24, 25, 30, 50, 60].map((v) => <option key={v} value={v}>{v} fps</option>)}</select></label></div>
      <p className="field-note">{dimensions.map(Math.round).join(' × ')} output pixels</p>
      <label className="form-field">Composition engine<select value={engine} onChange={(e) => { if (e.target.value === 'remotion') { void api.invoke('settings.get', {}).then((s) => { if (s.remotionLicenseAcknowledgedAt) setEngine('remotion'); else setLicence(true); }).catch((r: unknown) => setError(errorMessage(r))); } else setEngine('hyperframes'); }}><option value="hyperframes">HyperFrames</option><option value="remotion">Remotion</option></select></label>
      {!inPlace && <div className="form-field"><span>Footage folder (optional)</span><div className="form-row"><span className="literal-path">{footage?.displayPath ?? 'No footage selected'}</span><button type="button" className="button" disabled={busy} onClick={() => { void pick('footage'); }}>Choose footage</button>{footage && <button type="button" className="button" onClick={() => setFootage(null)}>Remove</button>}</div><small>Copies files into Footage (raw/). Originals stay where they are.</small></div>}
      {error && <Notice danger>{error}</Notice>}
    </form>
  </Dialog>{licence && <Dialog title="Using Remotion" onClose={() => setLicence(false)} footer={<><button className="button" onClick={() => setLicence(false)}>Cancel</button><button className="button primary" onClick={() => { void api.invoke('settings.update', { patch: { remotionLicenseAcknowledgedAt: new Date().toISOString() } }).then(() => { setLicence(false); setEngine('remotion'); }).catch((r: unknown) => setError(errorMessage(r))); }}>I understand</button></>}><p>Remotion is free for individuals and companies with up to 3 people. Larger companies need a Remotion licence. Review the licence at remotion.dev before using it commercially.</p></Dialog>}</>;
}
