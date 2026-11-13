import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, FolderOpen, History, House, Plus, SlidersHorizontal, X } from 'lucide-react';
import { EMPTY_TIMELINE } from '../shared/types';
import type { Cuts, Mark, MediaFile, Project, Script, Timeline as TimelineData, ToolStatus } from '../shared/types';
import { Chat } from './Chat';
import { AddFiles } from './AddFiles';
import { Features } from './Features';
import { Home } from './Home';
import { Preview } from './Preview';
import { Sources, Versions } from './ProjectPanels';
import { Timeline } from './Timeline';
import { api } from './lib';

export type PreviewState = { rendering: boolean; version: number; error?: string };

export function App() {
  const [project, setProject] = useState<Project | null>(null);
  /** The project's chats, each with its own edit, and the one on screen. */
  const [cuts, setCuts] = useState<Cuts>({ cuts: [], active: '' });
  const [timeline, setTimeline] = useState<TimelineData | null>(null);
  const [preview, setPreview] = useState<PreviewState>({ rendering: false, version: 0 });
  const [media, setMedia] = useState<MediaFile[]>([]);
  const [tools, setTools] = useState<ToolStatus[]>([]);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [pro, setPro] = useState(() => localStorage.getItem('mode') === 'pro');
  /** The export: how far the running one is (0–1), then the finished file. `open` shows it in a dialog. */
  const [exported, setExported] = useState<{ busy: boolean; done?: number; file?: string; error?: string; open?: boolean }>({ busy: false });
  const [script, setScript] = useState<Script>({ text: '', pending: false, spokenCut: false });
  /** The one popover that is open, if any. */
  const [panel, setPanel] = useState<'' | 'add' | 'versions' | 'settings'>('');
  const toggle = (name: typeof panel): void => setPanel(panel === name ? '' : name);
  const video = useRef<HTMLVideoElement>(null);
  const sender = useRef<((text: string) => void) | null>(null);

  useEffect(() => {
    void api.tools().then(setTools);
    const off = [
      api.on('timeline', setTimeline),
      api.on('preview', setPreview),
      api.on('script', setScript),
      api.on('media', setMedia),
      api.on('export', (done) => setExported((now) => (now.busy ? { ...now, done } : now))),
      api.on('tools', setTools),
    ];
    return () => off.forEach((stop) => stop());
  }, []);
  useEffect(() => localStorage.setItem('mode', pro ? 'pro' : 'simple'), [pro]);

  /** Forget everything that belonged to the edit on screen before. */
  const reset = async (): Promise<void> => {
    setMarks([]);
    setPanel('');
    history.current = { past: [], future: [] };
    // An export that is still running keeps reporting.
    setExported((now) => (now.busy ? now : { busy: false }));
    setTimeline(await api.getTimeline());
    setScript(await api.getScript());
  };
  const opened = async (next: Project | null): Promise<void> => {
    if (!next) return;
    await reset();
    setCuts(await api.cuts());
    setMedia(await api.listMedia());
    setProject(next);
  };
  /** Another chat was opened, made or split off: show its edit. */
  const changeCuts = async (next: Cuts): Promise<void> => {
    if (next.active !== cuts.active) await reset();
    setCuts(next);
  };
  const addMark = useCallback((mark: Mark) => setMarks((all) => [...all, mark]), []);
  // Manual edits are undoable; each one is written to timeline.json, which re-renders the preview.
  const history = useRef({ past: [] as (TimelineData | null)[], future: [] as (TimelineData | null)[] });
  const apply = (next: TimelineData | null): void => {
    setTimeline(next);
    void api.saveTimeline(next ?? EMPTY_TIMELINE);
  };
  const editTimeline = (next: TimelineData): void => {
    history.current.past.push(timeline);
    history.current.future = [];
    apply(next);
  };
  const step = (from: 'past' | 'future'): void => {
    const { [from]: stack, [from === 'past' ? 'future' : 'past']: other } = history.current;
    if (!stack.length) return;
    other.push(timeline);
    apply(stack.pop()!);
  };
  const exportVideo = async (): Promise<void> => {
    setExported({ busy: true, done: 0 });
    setExported(await api.exportVideo().then((file) => ({ busy: false, file, open: true }), (e: Error) => ({ busy: false, error: e.message })));
  };
  const drop = (event: React.DragEvent): void => {
    event.preventDefault();
    if (project) void api.importFiles([...event.dataTransfer.files].map((file) => api.pathForFile(file)));
  };

  const missing = tools.filter((tool) => tool.state !== 'ready');
  const toolNote = missing.length > 0 && (
    <span className="note" title={missing.map((t) => `${t.name}: ${t.detail ?? t.state}`).join('\n')}>
      {missing.some((t) => t.state === 'installing') ? 'Installing' : 'Missing'}: {missing.map((t) => t.name).join(', ')}
    </span>
  );

  if (!project) return <Home onOpen={opened}>{toolNote}</Home>;

  return (
    <div className={pro ? 'app pro' : 'app'} onDragOver={(e) => e.preventDefault()} onDrop={drop}>
      <header>
        <button className="ghost" title="Projects, styles and settings" onClick={() => void api.closeProject().then(() => setProject(null))}>
          <House size={16} /> Home
        </button>
        <strong>{project.name}</strong>
        <button className={panel === 'add' ? 'active' : 'ghost'} title="Add footage, logos, music or videos from links" onClick={() => toggle('add')}>
          <Plus size={16} /> Add files
        </button>
        {toolNote}
        <span className="spacer" />
        {exported.error && <span className="note error" title={exported.error}>Export failed</span>}
        {exported.file && (
          <button className="ghost" title="Watch the exported video" onClick={() => setExported({ ...exported, open: true })}>Show {exported.file}</button>
        )}
        <button className={panel === 'versions' ? 'active' : 'ghost'} title="Earlier versions of this chat’s edit" onClick={() => toggle('versions')}>
          <History size={16} /> Versions
        </button>
        <button className={panel === 'settings' ? 'active' : 'ghost'} title="Features and sources of this project" onClick={() => toggle('settings')}>
          <SlidersHorizontal size={16} /> Project settings
        </button>
        <div className="switch" role="tablist" aria-label="Interface">
          <button role="tab" aria-selected={!pro} onClick={() => setPro(false)}>Simple</button>
          <button role="tab" aria-selected={pro} onClick={() => setPro(true)}>Pro</button>
        </div>
        <button className="primary" disabled={!timeline?.clips.length || exported.busy} onClick={() => void exportVideo()}>
          <Download size={16} /> {exported.busy ? `Exporting… ${Math.floor((exported.done ?? 0) * 100)}%` : 'Export'}
        </button>
        {exported.busy && <progress className="export-progress" value={exported.done ?? 0} />}
      </header>
      <Preview
        video={video} cut={cuts.active} timeline={timeline} preview={preview} media={media} marks={marks} onMark={addMark} script={script}
        onApprove={() => sender.current?.('The storyboard is approved. Create the video.')}
        onHook={(n, hook) => sender.current?.(`Use hook ${n} as the opening instead: “${hook}”. Update the storyboard.`)}
        onApproveSpokenCut={() => void api.approveSpokenCut().then(() => sender.current?.('The spoken cut is approved. Now add the visuals and sound.'))}
      />
      {exported.open && exported.file && (
        <div className="modal" onClick={() => setExported({ ...exported, open: false })}>
          <section className="exported" role="dialog" aria-label="Export finished" onClick={(e) => e.stopPropagation()}>
            <header>
              <strong>Export finished</strong>
              <span className="note">{exported.file}</span>
              <span className="spacer" />
              <button className="ghost round" title="Close" onClick={() => setExported({ ...exported, open: false })}><X size={16} /></button>
            </header>
            <video src={`media://project/${encodeURI(exported.file)}`} controls autoPlay />
            <footer>
              <button onClick={() => setExported({ ...exported, open: false })}>Close</button>
              <button className="primary" onClick={() => void api.reveal(exported.file!)}><FolderOpen size={16} /> Open in Folder</button>
            </footer>
          </section>
        </div>
      )}
      {panel && <div className="backdrop" onClick={() => setPanel('')} />}
      {panel === 'add' && <AddFiles />}
      {panel === 'versions' && <Versions current={timeline} onRestore={editTimeline} />}
      {panel === 'settings' && (
        <aside className="project-settings">
          <strong>Features in this project</strong>
          <p className="hint">Switch off what Claude should not use here. Defaults and accounts are on Home.</p>
          <Features scope="project" />
          <Sources />
        </aside>
      )}
      <Chat
        key={project.root} cuts={cuts} onCuts={(next) => void changeCuts(next)}
        timeline={timeline} onRestore={editTimeline} marks={marks} setMarks={setMarks} media={media} sender={sender}
      />
      {pro && (
        <Timeline
          video={video} timeline={timeline} media={media} onChange={editTimeline} onMark={addMark}
          onUndo={() => step('past')} onRedo={() => step('future')}
        />
      )}
    </div>
  );
}
