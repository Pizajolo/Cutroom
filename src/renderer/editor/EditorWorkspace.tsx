import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { Film, Import, Shield } from 'lucide-react';
import type { ProjectDoc } from '@shared/schema/project';
import { Tabs } from '../components/Tabs';
import { Notice } from '../components/Notice';
import { api } from '../lib/api';
import { errorMessage, useNavigation } from '../state/navigation';
import { MEDIA_DRAG_TYPE } from '../media/types';
import { UrlImportDialog } from '../media/UrlImportDialog';
import { Timeline } from './timeline/Timeline';
import { ScrubBar, Transport } from './preview/Transport';
import { PreviewMedia } from './preview/PreviewMedia';
import { addMedia, connectEditor, useEditor } from './store';
import { Inspector } from './Inspector';
import { Assistant } from './Assistant';
import { AudioDock } from './AudioDock';
import { TranscriptDock } from './TranscriptDock';
import { CompositionLayers, CompositionPicker } from './compositions';
const DOCK_TABS = ['Inspector', 'Audio', 'Assistant'] as const;
const LEFT_TABS = ['Media', 'Transcript'] as const;
export function EditorWorkspace({ project }: { project: ProjectDoc }) {
  const [safeAreas, setSafeAreas] = useState(false);
  const id = useId();
  const sourcesButton = useRef<HTMLButtonElement>(null), toolsButton = useRef<HTMLButtonElement>(null);
  const sourcesPanel = useRef<HTMLElement>(null), toolsPanel = useRef<HTMLElement>(null);
  const bandOf = () => window.innerWidth >= 1280 ? 'wide' : window.innerWidth >= 1120 ? 'medium' : 'compact';
  const [band, setBand] = useState(bandOf);
  const [panel, setPanel] = useState<'sources' | 'tools' | null>(() => window.innerWidth >= 1120 ? 'tools' : null);
  const closePanel = () => { (panel === 'sources' ? sourcesButton : toolsButton).current?.focus(); setPanel(null); };
  const togglePanel = (next: 'sources' | 'tools') => {
    if (panel === next) { closePanel(); return; }
    setPanel(next);
    requestAnimationFrame(() => (next === 'sources' ? sourcesPanel : toolsPanel).current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus());
  };
  useEffect(() => {
    const resize = () => {
      const next = bandOf();
      if (next === band) return;
      if (next !== 'wide') {
        if (sourcesPanel.current?.contains(document.activeElement)) sourcesButton.current?.focus();
        if (toolsPanel.current?.contains(document.activeElement) && next === 'compact') toolsButton.current?.focus();
      }
      setPanel(next === 'medium' ? 'tools' : null); setBand(next);
    };
    window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize);
  }, [band]);
  const [left, setLeft] = useState<typeof LEFT_TABS[number]>('Media');
  const [urlOpen, setUrlOpen] = useState(false);
  const [compositionsOpen, setCompositionsOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const dock = useNavigation((s) => s.dock);
  const sourceRel = useNavigation((s) => s.sourceRel);
  const state = useEditor();
  useEffect(() => connectEditor(), [project.id]);
  const source = state.media.find((f) => f.rel === sourceRel);
  const importFiles = async () => {
    setImporting(true);
    try { await api.invoke('media.importDialog', { destination: 'raw' }); await useEditor.getState().loadMedia(); }
    catch (r) { useEditor.setState({ error: errorMessage(r) }); } finally { setImporting(false); }
  };
  return <div className={`editor-workspace${dock === 'Assistant' ? ' editor-assistant-open' : ''}${panel ? ` compact-${panel}-open` : ''}`} onKeyDown={(event) => { if (event.key === 'Escape' && band !== 'wide' && panel) { event.preventDefault(); closePanel(); } }}><div className="compact-editor-toolbar"><button ref={sourcesButton} className="button" aria-expanded={panel === 'sources'} aria-controls={`${id}-sources`} onClick={() => togglePanel('sources')}>Sources</button><button ref={toolsButton} className="button" aria-expanded={panel === 'tools'} aria-controls={`${id}-tools`} onClick={() => togglePanel('tools')}>Editor tools</button></div>{state.error && <Notice danger action={<button className="button" onClick={() => { useEditor.setState({ error: null }); void state.reload(); }}>Refresh edit</button>}>{state.error}</Notice>}<div className="editor-upper"><aside ref={sourcesPanel} id={`${id}-sources`} className="media-bin" aria-label="Media bin" data-workspace-region tabIndex={-1}><button className="button compact-panel-close" onClick={closePanel}>Close sources</button><Tabs label="Sources" tabs={LEFT_TABS} value={left} onChange={setLeft}>{left === 'Transcript' ? <TranscriptDock /> : <><div className="panel-heading"><h2>Media</h2><button type="button" className="icon-button" aria-label="Import files" disabled={importing} onClick={() => { void importFiles(); }}><Import size={16} /></button></div><div className="bin-actions"><button className="button" onClick={() => setUrlOpen(true)}>Import from URL</button><button className="button" onClick={() => setCompositionsOpen(true)}>Add composition</button></div>{!state.media.length ? <div className="bin-empty"><Film size={28} /><h3>Add footage to start editing.</h3><p>Import files or drag media onto a timeline track. Sources are read-only for agents.</p><button className="button" disabled={importing} onClick={() => { void importFiles(); }}>Import files</button></div> : <ul className="bin-media-list">{state.media.map((file) => <li key={file.rel} draggable={file.kind !== 'other'} onDragStart={(e) => { e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData(MEDIA_DRAG_TYPE, JSON.stringify({ rel: file.rel })); }}><button className="bin-source" onClick={() => useNavigation.setState({ sourceRel: file.rel })}><Film size={16} /><span>{file.name}<small>{file.kind}</small></span></button><button className="button quiet-button" disabled={file.kind === 'other'} aria-label={`Add ${file.name} to timeline`} onClick={() => { void addMedia(file); }}>Add</button></li>)}</ul>}</>}</Tabs></aside>
    <section className="preview-panel" aria-label="Preview" data-workspace-region tabIndex={-1}><div className="panel-heading"><h2>{source ? 'Source preview' : 'Preview'}</h2><span className="quiet">{project.format.width} × {project.format.height} · {project.format.fps} fps</span><button type="button" className="icon-button" aria-label="Safe-area guides" aria-pressed={safeAreas} onClick={() => setSafeAreas(!safeAreas)}><Shield size={16} /></button>{source && <button className="button" onClick={() => useNavigation.setState({ sourceRel: null })}>Timeline</button>}</div><div className="preview-mat"><div className="preview-canvas" style={{ '--canvas-aspect': project.format.width / project.format.height } as CSSProperties}>{source ? source.kind === 'video' ? <video src={source.url} className="preview-media" controls /> : source.kind === 'audio' ? <audio src={source.url} controls /> : source.kind === 'image' ? <img className="preview-media" src={source.url} alt={source.name} /> : null : state.timeline ? <><PreviewMedia doc={state.timeline.doc} files={state.media} /><CompositionLayers doc={state.timeline.doc} projectId={project.id} /></> : <div className="preview-empty"><Film size={32} /><p>Loading your edit…</p></div>}{safeAreas && <div className="safe-guides" aria-label="Action-safe and title-safe guides"><div className="action-safe" /><div className="title-safe" /></div>}</div></div><ScrubBar /><Transport /></section>
    <aside ref={toolsPanel} id={`${id}-tools`} className="inspector-dock" aria-label="Editor tools" data-workspace-region tabIndex={-1}><button className="button compact-panel-close" onClick={closePanel}>Close editor tools</button><Tabs label="Editor tools" tabs={DOCK_TABS} value={dock} onChange={(dock) => useNavigation.setState({ dock })}>{dock === 'Inspector' ? <Inspector /> : dock === 'Audio' ? <AudioDock /> : <Assistant />}</Tabs></aside></div><Timeline doc={state.timeline?.doc ?? null} apply={state.timeline ? state.apply : undefined} onError={(error) => useEditor.setState({ error })} /><footer className="editor-status"><span>{state.error ?? (state.pending ? 'Saving…' : state.timeline ? `Saved · revision ${state.timeline.revision}` : 'Loading edit…')}</span><span>Sources remain unchanged</span></footer>{urlOpen && <UrlImportDialog onClose={() => setUrlOpen(false)} />}{compositionsOpen && <CompositionPicker onClose={() => setCompositionsOpen(false)} />}</div>;
}
