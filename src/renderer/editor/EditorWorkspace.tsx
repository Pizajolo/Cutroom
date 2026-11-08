import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Film, MessageSquare, Shield } from 'lucide-react';
import type { ProjectDoc } from '@shared/schema/project';
import { Tabs } from '../components/Tabs';
import { Notice } from '../components/Notice';
import { ResizeSeparator } from '../components/ResizeSeparator';
import { useNavigation } from '../state/navigation';
import { MediaBrowser, type MediaBrowserActions } from '../media/MediaBrowser';
import { Timeline } from './timeline/Timeline';
import { ScrubBar, Transport } from './preview/Transport';
import { PreviewMedia } from './preview/PreviewMedia';
import { connectEditor, useEditor } from './store';
import { Inspector } from './Inspector';
import { Assistant } from './Assistant';
import { useAssistant } from './assistantStore';
import { AudioDock } from './AudioDock';
import { TranscriptDock } from './TranscriptDock';
import { CompositionLayers } from './compositions';
const DOCK_TABS = ['Media', 'Inspector', 'Audio', 'Transcript'] as const;
export function EditorWorkspace({ project }: { project: ProjectDoc }) {
  const mediaBrowser = useRef<MediaBrowserActions>(null);
  const [safeAreas, setSafeAreas] = useState(false);
  const [windowSize, setWindowSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [panelOpen, setPanelOpen] = useState(false);
  const [chatWidth, setChatWidth] = useState(380);
  const [timelineHeight, setTimelineHeight] = useState(window.innerHeight < 780 ? 280 : 396);
  const panel = useRef<HTMLElement>(null), opener = useRef<HTMLButtonElement>(null);
  const compact = windowSize.width < 1120;
  const collapsed = useNavigation((s) => s.chatCollapsed);
  const dock = useNavigation((s) => s.dock);
  const root = useNavigation((s) => s.project?.rootPath ?? '');
  const questions = useAssistant((s) => ['interrupted', 'finished'].includes(s.status) ? 0 : s.questions.filter((q) => !s.answeredQuestionIds.includes(q.requestId)).length + s.permissions.length);
  const state = useEditor();
  const actualChat = collapsed ? 40 : windowSize.width < 1280 ? 320 : Math.min(chatWidth, Math.max(320, windowSize.width - 56 - 300 - 360));
  const actualTimeline = Math.min(timelineHeight, windowSize.height * .65, Math.max(240, windowSize.height - 44 - 230 - 24));
  useEffect(() => connectEditor(), [project.id]);
  useEffect(() => { const resize = () => { if (window.innerWidth < 1120 && windowSize.width >= 1120 && panel.current?.contains(document.activeElement)) opener.current?.focus(); setWindowSize({ width: window.innerWidth, height: window.innerHeight }); }; window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize); }, [windowSize.width]);
  const closePanel = () => { opener.current?.focus(); setPanelOpen(false); };
  const focusChat = () => useNavigation.setState((s) => ({ chatCollapsed: false, chatFocusRequest: s.chatFocusRequest + 1 }));
  const empty = state.timeline && !state.timeline.doc.tracks.some((t) => t.items.length);
  return <div className={`editor-workspace${collapsed ? ' chat-collapsed' : ''}${compact && !panelOpen ? ' right-panel-closed' : ''}`} style={{ '--desk-chat-width': `${actualChat}px`, '--desk-timeline-height': `${actualTimeline}px` } as CSSProperties}>
    {state.error && <Notice danger action={<button className="button" onClick={() => { useEditor.setState({ error: null }); void state.reload(); }}>Refresh edit</button>}>{state.error}</Notice>}
    <div className="editor-upper"><aside className="chat-panel" aria-label="Chat" data-workspace-region tabIndex={-1}><div hidden={collapsed} className="chat-panel-body"><Assistant /></div>{collapsed && <button className="chat-open-button" aria-label={`Open chat${questions ? `, ${questions} pending answers` : ''}`} onClick={focusChat}><MessageSquare size={18} /><span>Chat</span>{questions > 0 && <strong>{questions}</strong>}</button>}</aside>
      {!collapsed && <ResizeSeparator label="Chat width" value={actualChat} min={320} max={Math.min(520, Math.max(320, windowSize.width - 716))} initial={380} onChange={setChatWidth} />}
      <section className="preview-panel" onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }} onDrop={(e) => { if (!e.dataTransfer.types.includes('Files')) return; e.preventDefault(); const files = [...e.dataTransfer.files]; if (files.length) { mediaBrowser.current?.importFiles(files); setPanelOpen(true); useNavigation.setState({ dock: 'Media' }); } }} aria-label="Preview" data-workspace-region tabIndex={-1}><div className="panel-heading"><h2>Preview</h2><span className="quiet preview-metadata">{project.format.width} × {project.format.height} · {project.format.fps} fps</span><button className="button compact-media-opener" ref={opener} aria-expanded={!compact || panelOpen} onClick={() => setPanelOpen(!panelOpen)}>Media</button><button className="icon-button" aria-label="Safe-area guides" aria-pressed={safeAreas} onClick={() => setSafeAreas(!safeAreas)}><Shield size={16} /></button></div><div className="preview-mat"><div className="preview-canvas" style={{ '--canvas-aspect': project.format.width / project.format.height } as CSSProperties}>{state.timeline && !empty ? <><PreviewMedia doc={state.timeline.doc} files={state.media} /><CompositionLayers doc={state.timeline.doc} projectId={project.id} /></> : <div className="preview-empty"><Film size={32} /><p>{empty ? 'Bring in footage, or describe your video in chat.' : 'Loading your edit…'}</p>{empty && <div className="form-row"><button className="button" onClick={() => { setPanelOpen(true); useNavigation.setState({ dock: 'Media' }); mediaBrowser.current?.openAdd(); }}>Add media</button><button className="button" onClick={focusChat}>Focus chat</button></div>}</div>}{safeAreas && <div className="safe-guides" aria-label="Action-safe and title-safe guides"><div className="action-safe" /><div className="title-safe" /></div>}</div></div><ScrubBar /><Transport /></section>
      <aside ref={panel} className="inspector-dock" aria-label="Project panel" hidden={compact && !panelOpen} data-workspace-region tabIndex={-1} onKeyDown={(e) => { if (e.key === 'Escape' && compact) { e.preventDefault(); closePanel(); } }}><button className="button compact-panel-close" onClick={closePanel}>Close panel</button><Tabs label="Project panel" tabs={DOCK_TABS} value={dock} onChange={(dock) => useNavigation.setState({ dock })}><div hidden={dock !== 'Media'}><MediaBrowser folder={{ id: project.id, root }} ref={mediaBrowser} /></div>{dock === 'Inspector' ? <Inspector /> : dock === 'Audio' ? <AudioDock /> : dock === 'Transcript' ? <TranscriptDock /> : null}</Tabs></aside></div>
    <ResizeSeparator label="Timeline height" horizontal value={actualTimeline} min={240} max={Math.max(240, Math.min(windowSize.height * .65, windowSize.height - 298))} initial={396} onChange={setTimelineHeight} />
    <Timeline doc={state.timeline?.doc ?? null} apply={state.timeline ? state.apply : undefined} onError={(error) => useEditor.setState({ error })} /><footer className="editor-status"><span>{state.pending ? 'Saving…' : state.timeline ? `Saved · revision ${state.timeline.revision}` : 'Loading edit…'}</span><span>Sources remain unchanged</span></footer>
  </div>;
}
