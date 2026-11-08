import { useCallback, useEffect, useImperativeHandle, useRef, useState, type DragEvent, type Ref } from 'react';
import { MoreHorizontal, Plus, Search, X } from 'lucide-react';
import type { MediaFile } from '@shared/schema/media';
import type { EventPayload } from '@shared/ipc';
import { api } from '../lib/api';
import { formatDuration } from '../lib/time';
import { Dialog } from '../components/Dialog';
import { Notice } from '../components/Notice';
import { useNavigation } from '../state/navigation';
import { MediaThumbnail } from './MediaThumbnail';
import { IMPORT_DESTINATIONS, MEDIA_DRAG_TYPE, MEDIA_SECTIONS, type ImportDestination, type MediaFolder } from './types';

import { addMedia, useEditor } from '../editor/store';
import { CompositionPicker } from '../editor/compositions';
import { UrlImportDialog } from './UrlImportDialog';
const messageOf = (reason: unknown) => reason instanceof Error ? reason.message : 'The media folder could not be read.';
const isRoot = (file: MediaFile) => ('section' in file && file.section === 'root') || !file.rel.includes('/');

function InlinePlayer({ file, onClose }: { file: MediaFile; onClose: () => void }) {
  const [error, setError] = useState(false);
  return <section className="source-player" aria-label={`Source: ${file.name}`}>
    <header><span className="source-pill">Source</span><h2>{file.name}</h2><button type="button" className="icon-button" aria-label="Back to timeline" onClick={onClose}><X size={16} /></button></header>
    {file.kind === 'video' ? <video key={file.url} src={file.url} controls autoPlay preload="metadata" onError={() => setError(true)} /> : file.kind === 'audio' ? <audio key={file.url} src={file.url} controls autoPlay preload="metadata" onError={() => setError(true)} /> : file.kind === 'image' ? <img src={file.url} alt={file.name} onError={() => setError(true)} /> : <p>This file has no inline preview.</p>}
    {error && <p className="field-error" role="alert">This source couldn't be played. Check that the file is available and uses a supported format.</p>}
  </section>;
}

export interface MediaBrowserActions { openAdd: () => void; importFiles: (files: File[]) => void }
export function MediaBrowser({ folder, ref }: { folder: MediaFolder; ref?: Ref<MediaBrowserActions> }) {
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [urlOpen, setUrlOpen] = useState(false);
  const [copyNote, setCopyNote] = useState('');
  const [compositionsOpen, setCompositionsOpen] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const addMenu = useRef<HTMLDivElement>(null);
  const fileActions = (file: MediaFile) => <div className="media-card-actions"><button className="button" disabled={file.kind === 'other'} onClick={() => { void addMedia(file).then((added) => { if (!added) setError(useEditor.getState().error ?? 'This media could not be added to the edit.'); }).catch((r: unknown) => setError(messageOf(r))); }}>Add to timeline</button><button className="button" disabled={file.kind === 'other'} onClick={() => { useNavigation.setState({ sourceRel: file.rel, dock: 'Inspector' }); }}>Inspect</button>{isRoot(file) && <button className="button" onClick={() => { void api.invoke('project.adoptLooseMedia', { rels: [file.rel] }).then((added) => { setHighlighted(added.map((f) => f.rel)); setSelected(added[0]?.rel ?? null); setCopyNote('Copied to Footage. Original kept.'); reload(); }).catch((r: unknown) => setError(messageOf(r))); }}>Copy into Footage</button>}{file.kind === 'other' && <small>Unsupported media type</small>}</div>;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<string[]>([]);
  const [destination, setDestination] = useState<ImportDestination>('raw');
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<EventPayload<'media.progress'> | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const dropDepth = useRef(0);
  const current = useRef(true);
  const reload = useCallback(() => setRefresh((value) => value + 1), []);
  useEffect(() => { current.current = true; return () => { current.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    void api.invoke('media.list', {}).then((value) => { if (active) { setFiles(value); setError(null); setLoading(false); } }).catch((reason: unknown) => { if (active) { setError(messageOf(reason)); setLoading(false); } });
    return () => { active = false; };
  }, [folder.id, refresh]);
  useEffect(() => api.on('media.changed', (event) => { if (event.projectId === folder.id) reload(); }), [folder.id, reload]);
  useEffect(() => api.on('media.progress', (event) => { if (event.projectId === folder.id) setProgress(event); }), [folder.id]);
  const cancelMediaWork = async () => {
    setCancelling(true);
    try { await api.invoke('media.cancel', {}); }
    catch (reason) { if (current.current) setImportError(messageOf(reason)); }
    finally { if (current.current) setCancelling(false); }
  };
  const closeImport = () => { setImportOpen(false); if (!importing) setPendingFiles(null); };
  const showImport = (target: ImportDestination = 'raw') => { if (importing) return; setDestination(target); setPendingFiles(null); setImportError(null); setImportOpen(true); };
  const performImport = async () => {
    setImporting(true); setImportError(null); setProgress(null);
    try {
      // Resolve File grants only at commit, immediately before the guarded IPC call.
      const paths = pendingFiles?.map((file) => api.getPathForFile(file));
      if (paths?.some((path) => !path)) throw new Error('The dropped files could not be located. Use Import files instead.');
      const added = paths ? await api.invoke('media.importPaths', { paths, destination }) : await api.invoke('media.importDialog', { destination });
      if (!current.current) return;
      setHighlighted(added.map((file) => file.rel)); setImportOpen(false); setPendingFiles(null); reload();
    } catch (reason) { if (current.current) setImportError(messageOf(reason)); }
    finally { if (current.current) { setImporting(false); reload(); } }
  };
  const offerFiles = (files: File[], target: ImportDestination = 'raw') => {
    if (!files.length || importing) return;
    if (files.length > 100) { setError('Import up to 100 files at a time. Split this selection into smaller batches.'); return; }
    setPendingFiles(files); setDestination(target); setImportError(null); setImportOpen(true);
  };
  useImperativeHandle(ref, () => ({ openAdd: () => setAddOpen(true), importFiles: offerFiles }));
  useEffect(() => { if (!addOpen) return; const outside = (event: PointerEvent) => { if (!addMenu.current?.contains(event.target as Node) && !addButton.current?.contains(event.target as Node)) setAddOpen(false); }; document.addEventListener('pointerdown', outside); return () => document.removeEventListener('pointerdown', outside); }, [addOpen]);
  const drop = (event: DragEvent<HTMLElement>, target?: ImportDestination) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault(); event.stopPropagation(); setDropActive(false); dropDepth.current = 0;
    if (importing) return;
    offerFiles([...event.dataTransfer.files], target);
  };
  const filtered = files.filter((file) => file.name.toLowerCase().includes(query.toLowerCase()));
  const selectedFile = files.find((file) => file.rel === selected);
  return <div className={`media-page${dropActive ? ' media-drop-active' : ''}`} data-workspace-region tabIndex={-1}
    onDragEnter={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); dropDepth.current++; setDropActive(true); } }}
    onDragLeave={() => { dropDepth.current = Math.max(0, dropDepth.current - 1); if (!dropDepth.current) setDropActive(false); }}
    onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }} onDrop={drop}>
    <header className="media-toolbar"><div className="media-search"><Search size={14} aria-hidden="true" /><input aria-label="Search media" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search media" /></div><button ref={addButton} className="button" aria-haspopup="menu" aria-expanded={addOpen} onClick={() => setAddOpen(!addOpen)} disabled={importing}><Plus size={14} />Add</button>
      {addOpen && <div ref={addMenu} className="media-add-menu" role="menu" aria-label="Add media" onKeyDown={(e) => { const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button')]; const index = buttons.indexOf(document.activeElement as HTMLButtonElement); if (e.key === 'Tab') { setAddOpen(false); } else if (e.key === 'Escape') { e.preventDefault(); setAddOpen(false); addButton.current?.focus(); } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) { e.preventDefault(); buttons[e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus(); } }}><button role="menuitem" autoFocus onClick={() => { setAddOpen(false); showImport(); }}>Import files</button><button role="menuitem" onClick={() => { setAddOpen(false); setUrlOpen(true); }}>Import from URL</button><button role="menuitem" onClick={() => { setAddOpen(false); setCompositionsOpen(true); }}>Add composition</button></div>}
    </header>
    {urlOpen && <UrlImportDialog onClose={() => setUrlOpen(false)} />}
    {compositionsOpen && <CompositionPicker onClose={() => setCompositionsOpen(false)} />}
    {copyNote && <Notice>{copyNote}</Notice>}
    {error && <Notice danger action={<button className="button" onClick={reload}>Refresh</button>}>{error}</Notice>}
    {importing && !importOpen && <Notice action={<button className="button" onClick={() => setImportOpen(true)}>Show import</button>}>Importing files…</Notice>}
    {!importOpen && importError && <Notice danger>{importError}</Notice>}
    {selectedFile && playing === selectedFile.rel && <InlinePlayer key={selectedFile.rel} file={selectedFile} onClose={() => setPlaying(null)} />}
    <div className="media-sections" aria-busy={loading}>{[...MEDIA_SECTIONS, ...(files.some(isRoot) ? [{ directory: 'root', name: 'Folder root', readOnly: true }] : [])].map((section) => {
      const sectionFiles = filtered.filter((file) => section.directory === 'root' ? isRoot(file) : file.rel.startsWith(`${section.directory}/`));
      return <details className="media-section" role="region" aria-label={section.name} key={section.directory} open><summary title={section.directory === 'root' ? folder.root : `${section.directory}/`}>{section.name}<span className="quiet">{sectionFiles.length}</span></summary>{section.directory === 'root' && <p className="field-note">Files stay here. Agents can't change them.</p>}
        {loading ? <p className="media-section-empty">Loading media…</p> : !sectionFiles.length ? <p className="media-section-empty">{query ? 'No matching files.' : `No ${section.name.toLowerCase()} yet.`}</p> : <ul className="media-rows">{sectionFiles.map((file) => <li key={file.rel} className={selected === file.rel ? 'media-row-selected' : ''}><button className="media-row" aria-label={`Select ${file.name}`} aria-pressed={selected === file.rel} title={file.rel} onClick={() => setSelected(file.rel)} onDoubleClick={() => { setSelected(file.rel); setPlaying(file.rel); }} draggable={file.kind !== 'other'} onDragStart={(event) => { event.dataTransfer.effectAllowed = 'copy'; event.dataTransfer.setData(MEDIA_DRAG_TYPE, JSON.stringify({ rel: file.rel })); }}><MediaThumbnail file={file} /><span><strong>{file.name}</strong><small>{file.kind} · {file.probe ? formatDuration(file.probe.duration) : file.kind === 'image' ? 'Still image' : 'Duration unavailable'}{highlighted.includes(file.rel) ? ' · Imported' : ''}</small>{file.error && <small className="field-error">{file.error.message}</small>}</span></button><details className="media-row-menu" onKeyDown={(e) => { const details = e.currentTarget; const buttons = [...details.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]; if (e.key === 'Escape') { e.preventDefault(); details.open = false; details.querySelector('summary')?.focus(); } else if (details.open && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) { e.preventDefault(); const index = buttons.indexOf(document.activeElement as HTMLButtonElement); buttons[e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus(); } }}><summary aria-label={`Actions for ${file.name}`}><MoreHorizontal size={16} /></summary>{fileActions(file)}</details></li>)}</ul>}
      </details>;
    })}</div>
    {importOpen && <Dialog title="Import files" onClose={closeImport} footer={<><button type="button" className="button" onClick={closeImport}>{importing ? 'Run in background' : 'Cancel'}</button><button type="button" className="button primary" disabled={importing} onClick={() => { void performImport(); }}>{importing ? 'Importing files…' : pendingFiles ? `Import ${pendingFiles.length} ${pendingFiles.length === 1 ? 'file' : 'files'}` : 'Choose files'}</button></>}>
      <p>Files are copied into the selected project folder. Originals stay in place.</p><label className="form-field">Destination<select value={destination} disabled={importing} onChange={(event) => setDestination(event.target.value as ImportDestination)}>{IMPORT_DESTINATIONS.map((name) => <option key={name} value={name}>{MEDIA_SECTIONS.find((section) => section.directory === name)?.name} ({name}/)</option>)}</select></label>
      {pendingFiles && <p className="field-note">{pendingFiles.length} {pendingFiles.length === 1 ? 'file is' : 'files are'} ready to import. Confirm the destination before copying.</p>}
      {importing && <div className="import-progress"><p>{progress ? `${({ import: 'Copying', probe: 'Reading metadata', thumbnails: 'Preparing thumbnails', waveform: 'Preparing waveform' } as const)[progress.stage]}: ${progress.rel}` : 'Importing files…'}</p>
        {progress && <><progress max={1} value={progress.progress} aria-label={`${progress.stage} progress`} /><span>{Math.round(progress.progress * 100)}% of this step</span></>}
        <button type="button" className="button" disabled={cancelling} onClick={() => { void cancelMediaWork(); }}>{cancelling ? 'Requesting cancellation…' : 'Cancel media work'}</button><p className="field-note">Cancels pending imports and media preparation. Files already copied remain available.</p></div>}
      {importError && <p className="field-error" role="alert">{importError}</p>}
    </Dialog>}
  </div>;
}
