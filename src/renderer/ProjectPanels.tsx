import { useEffect, useState } from 'react';
import { FolderOpen, Star, Undo2 } from 'lucide-react';
import type { LedgerEntry, Timeline, Version } from '../shared/types';
import { api } from './lib';

const when = (iso: string): string => new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Every step of Claude's that changed the edit, and every export, newest first. */
export function Versions({ current, onRestore }: { current: Timeline | null; onRestore: (timeline: Timeline) => void }) {
  const [versions, setVersions] = useState<Version[]>([]);
  useEffect(() => void api.versions().then(setVersions), []);
  const now = JSON.stringify(current);

  return (
    <aside className="project-settings versions">
      <strong>Versions</strong>
      <p className="hint">Each step of Claude’s that changed the edit, and each export. Going back is undoable.</p>
      {versions.length === 0 && <p className="hint">No versions yet.</p>}
      <ul className="list">
        {[...versions].reverse().map((v) => (
          <li key={v.id}>
            <span className="grow">
              <strong>v{v.id}</strong> {v.file ? <span className="tag">Export</span> : null} {v.final && <span className="tag ok">Final</span>}
              {JSON.stringify(v.timeline) === now && <span className="tag">Current</span>}
              <span className="description">{v.file ?? v.label} · {when(v.at)}</span>
            </span>
            {v.file && <button className="ghost" title="Show the exported video" onClick={() => void api.reveal(v.file!)}><FolderOpen size={14} /></button>}
            <button className={v.final ? 'active' : 'ghost'} title={v.final ? 'No longer the final version' : 'Mark as the final version'} onClick={() => void api.markFinal(v.id).then(setVersions)}>
              <Star size={14} />
            </button>
            <button className="ghost" title="Put the edit back to this version" disabled={JSON.stringify(v.timeline) === now} onClick={() => onRestore(v.timeline)}>
              <Undo2 size={14} /> Go back
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}

/** Where everything in the project that the user did not shoot came from. */
export function Sources() {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  useEffect(() => void api.ledger().then(setEntries), []);
  return (
    <>
      <strong>Sources and rights</strong>
      <p className="hint">Everything here that you did not shoot yourself: where it came from and what you may do with it.</p>
      {entries.length === 0 && <p className="hint">Nothing recorded yet.</p>}
      <ul className="list">
        {entries.map((entry) => (
          <li key={entry.file}>
            <button className="ghost grow tall" title="Show in Finder" onClick={() => void api.reveal(entry.file)}>
              <strong>{entry.file}</strong> {entry.license && <span className="tag">{entry.license}</span>}
              <span className="description">{entry.source}{entry.note ? ` — ${entry.note}` : ''}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
