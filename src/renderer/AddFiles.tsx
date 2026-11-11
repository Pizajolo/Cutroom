import { useState } from 'react';
import { FolderOpen, Link } from 'lucide-react';
import type { ImportDir } from '../shared/types';
import { api } from './lib';

const PLACES: { dir: ImportDir | ''; label: string }[] = [
  { dir: '', label: 'Automatic — sorted by type, links to references' },
  { dir: 'raw', label: 'raw — footage to cut' },
  { dir: 'references', label: 'references — inspiration only, never used in the video' },
  { dir: 'assets', label: 'assets — logos, images, music' },
];

/** Add media to the project: files from this Mac or videos from links, into the folder the user picks. */
export function AddFiles() {
  const [place, setPlace] = useState<ImportDir | ''>('');
  const [links, setLinks] = useState('');
  const [busy, setBusy] = useState(false);
  const [failures, setFailures] = useState<string[]>([]);
  const dir = place || undefined;
  const urls = links.split(/\s+/).filter(Boolean);

  const download = async (): Promise<void> => {
    setBusy(true);
    setFailures([]);
    const failed = await api.downloadLinks(urls, dir).catch((error: Error) => [error.message]);
    setFailures(failed);
    // Keep only the links that did not work, so they can be fixed and retried.
    setLinks(urls.filter((url) => failed.some((f) => f.startsWith(url))).join('\n'));
    setBusy(false);
  };

  return (
    <aside className="project-settings add-files">
      <strong>Add to the project</strong>
      <select value={place} aria-label="Where the files go" onChange={(e) => setPlace(e.target.value as ImportDir | '')}>
        {PLACES.map((p) => <option key={p.dir} value={p.dir}>{p.label}</option>)}
      </select>
      <button onClick={() => void api.importFiles(undefined, dir)}><FolderOpen size={14} /> Choose files…</button>
      <textarea
        value={links} placeholder="Or paste links — TikTok, Instagram Reels, YouTube… one per line"
        onChange={(e) => setLinks(e.target.value)}
      />
      <div className="row">
        <button disabled={busy || !urls.length} onClick={() => void download()}>
          <Link size={14} /> {busy ? 'Downloading…' : urls.length > 1 ? `Download ${urls.length} videos` : 'Download video'}
        </button>
        <span className="hint">Saved to {dir ?? 'references'}/</span>
      </div>
      {failures.map((failure) => <p key={failure} className="note error">{failure}</p>)}
    </aside>
  );
}
