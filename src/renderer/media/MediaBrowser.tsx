import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { FolderOpen, Import, Link, LockKeyhole, Search, X } from 'lucide-react';
import type { MediaFile } from '@shared/schema/media';
import type { EventPayload } from '@shared/ipc';
import { api } from '../lib/api';
import { formatBytes, formatDuration } from '../lib/time';
import { Dialog } from '../components/Dialog';
import { Notice } from '../components/Notice';
import { useNavigation } from '../state/navigation';
import { MediaThumbnail } from './MediaThumbnail';
import { IMPORT_DESTINATIONS, MEDIA_DRAG_TYPE, MEDIA_SECTIONS, type ImportDestination, type MediaFolder } from './types';

import { addMedia, useEditor } from '../editor/store';
import { UrlImportDialog } from './UrlImportDialog';
const messageOf = (reason: unknown) => reason instanceof Error ? reason.message : 'The media folder could not be read.';
export function BrowseMediaButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const select = async () => {
    setBusy(true); setError(null);
    try {
      await useNavigation.getState().pickProject();
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  };
  return <div className="browse-folder-action"><button type="button" className="button" disabled={busy} onClick={() => { void select(); }}><FolderOpen size={16} />{busy ? 'Choosing folder…' : 'Browse media folder'}</button>{error && <p className="field-error" role="alert">{error}</p>}</div>;
}

const isRoot = (file: MediaFile) => ('section' in file && file.section === 'root') || !file.rel.includes('/');

function InlinePlayer({ file, onClose }: { file: MediaFile; onClose: () => void }) {
  const [error, setError] = useState(false);
  return <section className="source-player" aria-label={`Source: ${file.name}`}>
    <header><span className="source-pill">Source</span><h2>{file.name}</h2><button type="button" className="icon-button" aria-label="Close source player" onClick={onClose}><X size={16} /></button></header>
    {file.kind === 'video' ? <video key={file.url} src={file.url} controls autoPlay preload="metadata" onError={() => setError(true)} /> : file.kind === 'audio' ? <audio key={file.url} src={file.url} controls autoPlay preload="metadata" onError={() => setError(true)} /> : file.kind === 'image' ? <img src={file.url} alt={file.name} onError={() => setError(true)} /> : <p>This file has no inline preview.</p>}
    {error && <p className="field-error" role="alert">This source couldn't be played. Check that the file is available and uses a supported format.</p>}
  </section>;
}

function MediaCard({ file, selected, highlighted, onSelect }: { file: MediaFile; selected: boolean; highlighted: boolean; onSelect: () => void }) {
  const probe = file.probe;
  return <button type="button" className={`media-card${selected ? ' media-card-selected' : ''}${highlighted ? ' media-card-new' : ''}`}
    aria-label={`Preview ${file.name}`} aria-pressed={selected} onClick={onSelect} draggable={file.kind === 'video' || file.kind === 'audio'}
    onDragStart={(event) => { event.dataTransfer.effectAllowed = 'copy'; event.dataTransfer.setData(MEDIA_DRAG_TYPE, JSON.stringify({ rel: file.rel })); }}>
    <MediaThumbnail file={file} /><div className="media-card-body"><strong title={file.name}>{file.name}</strong>
      <div className="media-metadata"><span>{probe ? formatDuration(probe.duration) : 'Duration unavailable'}</span><span>{file.kind}</span></div>
      {probe && <><div className="media-metadata"><span>{probe.width && probe.height ? `${probe.width} × ${probe.height}` : 'Audio / data'}</span><span>{probe.fps ? `${Number(probe.fps.toFixed(3))} fps` : ''}</span></div>
        <div className="media-metadata"><span>{probe.vcodec ?? probe.acodec ?? 'Unknown codec'}</span><span>{formatBytes(probe.size)}</span></div></>}
      {file.error && <span className="field-error">Metadata unavailable: {file.error.message}</span>}
      {highlighted && <span className="imported-label">Imported</span>}
    </div>
  </button>;
}

export function MediaBrowser({ folder }: { folder: MediaFolder }) {
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [urlOpen, setUrlOpen] = useState(false);
  const [copyNote, setCopyNote] = useState('');
  const fileActions = (file: MediaFile) => <div className="media-card-actions"><button className="button" disabled={file.kind === 'other'} onClick={() => { void addMedia(file).then((added) => { if (added) useNavigation.getState().setTab('Editor'); else setError(useEditor.getState().error ?? 'This media could not be added to the edit.'); }).catch((r: unknown) => setError(messageOf(r))); }}>Add to timeline</button><button className="button" disabled={file.kind === 'other'} onClick={() => { useNavigation.setState({ sourceRel: file.rel }); useNavigation.getState().setTab('Editor'); }}>Open in editor</button>{isRoot(file) && <button className="button" onClick={() => { void api.invoke('project.adoptLooseMedia', { rels: [file.rel] }).then((added) => { setHighlighted(added.map((f) => f.rel)); setSelected(added[0]?.rel ?? null); setCopyNote('Copied to Footage. Original kept.'); reload(); }).catch((r: unknown) => setError(messageOf(r))); }}>Copy into Footage</button>}{file.kind === 'other' && <small>Unsupported media type</small>}</div>;
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
  const drop = (event: DragEvent<HTMLElement>, target?: ImportDestination) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault(); event.stopPropagation(); setDropActive(false); dropDepth.current = 0;
    if (importing) return;
    try {
      const dropped = [...event.dataTransfer.files];
      if (!dropped.length) return;
      if (dropped.length > 100) throw new Error('Import up to 100 files at a time. Split this selection into smaller batches.');
      setPendingFiles(dropped); setDestination(target ?? 'raw'); setImportError(null); setImportOpen(true);
    } catch (reason) { setError(messageOf(reason)); }
  };
  const filtered = files.filter((file) => file.name.toLowerCase().includes(query.toLowerCase()));
  const selectedFile = files.find((file) => file.rel === selected);
  return <div className={`media-page${dropActive ? ' media-drop-active' : ''}`} data-workspace-region tabIndex={-1}
    onDragEnter={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); dropDepth.current++; setDropActive(true); } }}
    onDragLeave={() => { dropDepth.current = Math.max(0, dropDepth.current - 1); if (!dropDepth.current) setDropActive(false); }}
    onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }} onDrop={drop}>
    <header className="media-toolbar"><div className="media-search"><Search size={14} aria-hidden="true" /><input aria-label="Search media" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search media" />{query && <button type="button" className="icon-button" aria-label="Clear search" onClick={() => setQuery('')}><X size={14} /></button>}</div>
      <span className="media-count">{loading ? 'Loading media…' : `${files.length} files`}</span>
      <button type="button" className="button" onClick={() => showImport()} disabled={importing}><Import size={16} />Import files</button>
      <button type="button" className="button" onClick={() => setUrlOpen(true)}><Link size={16} />Import from URL</button>
    </header>
    <div className="media-folder-note"><span title={folder.root}>{folder.root}</span><span>Sources remain unchanged</span></div>
    {urlOpen && <UrlImportDialog onClose={() => setUrlOpen(false)} />}
    {copyNote && <Notice>{copyNote}</Notice>}
    {error && <Notice danger action={<button type="button" className="button" onClick={reload}>Refresh</button>}>{error}</Notice>}
    {importing && !importOpen && <Notice action={<button type="button" className="button" onClick={() => setImportOpen(true)}>Show import</button>}>Importing files in this folder…</Notice>}
    {!importOpen && importError && <Notice danger>{importError}</Notice>}
    {selectedFile && <InlinePlayer key={selectedFile.rel} file={selectedFile} onClose={() => setSelected(null)} />}
    <div className="media-sections" aria-busy={loading}>
      {filtered.some(isRoot) && <section className="media-section" aria-label="Folder root"><div className="media-section-heading"><h2>Folder root</h2><span>{filtered.filter(isRoot).length}</span><span className="source-guarantee"><LockKeyhole size={13} />Files stay in this folder. Agents can't change them.</span></div><div className="media-grid">{filtered.filter(isRoot).map((file) => <div key={file.rel}><MediaCard file={file} selected={selected === file.rel} highlighted={highlighted.includes(file.rel)} onSelect={() => setSelected(file.rel)} />{fileActions(file)}</div>)}</div></section>}
      {MEDIA_SECTIONS.map((section) => {
        const sectionFiles = filtered.filter((file) => file.rel.startsWith(`${section.directory}/`));
        const canImport = IMPORT_DESTINATIONS.some((name) => name === section.directory);
        const target = canImport ? section.directory as ImportDestination : undefined;
        return <section className="media-section" key={section.directory} aria-label={section.name} onDrop={(event) => drop(event, target)}>
          <div className="media-section-heading"><h2>{section.name}<small>{section.directory}/</small></h2><span className="quiet">{sectionFiles.length}</span>
            {section.readOnly && <span className="source-guarantee"><LockKeyhole size={13} />Read-only for agents</span>}
          </div>
          {loading ? <p className="media-section-empty">Loading {section.name.toLowerCase()}…</p> : sectionFiles.length ? <div className="media-grid">{sectionFiles.map((file) => <div key={file.rel}><MediaCard file={file} selected={selected === file.rel} highlighted={highlighted.includes(file.rel)} onSelect={() => setSelected(file.rel)} />{fileActions(file)}</div>)}</div> :
            <div className="media-section-empty"><p>{error ? 'This section could not be loaded. Refresh to try again.' : query ? 'No matching files in this section.' : `No ${section.name.toLowerCase()} yet.`}</p>{canImport && !query && <button type="button" className="button quiet-button" disabled={importing} onClick={() => showImport(target)}>Import files</button>}</div>}
        </section>;
      })}
    </div>
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
