import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { Skill, SkillDraft } from '../shared/types';
import { api, failed } from './lib';

/**
 * The styles and moves Claude just saved, before they join the library: watch each example, read its instructions,
 * and keep or drop it. Closing without deciding leaves them waiting (the Library page lists them).
 */
export function DraftReview({ drafts, onClose, onSaved }: { drafts: SkillDraft[]; onClose: () => void; onSaved: (skills: Skill[]) => void }) {
  const [keep, setKeep] = useState<string[]>(() => drafts.map((d) => d.name));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => void (e.key === 'Escape' && onClose());
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggle = (name: string): void => setKeep(keep.includes(name) ? keep.filter((k) => k !== name) : [...keep, name]);
  const save = (): void => {
    setBusy(true);
    const drop = drafts.map((d) => d.name).filter((n) => !keep.includes(n));
    void api.settleDrafts(keep, drop).then(onSaved, (e) => (setBusy(false), failed(e)));
  };
  const count = (kind: SkillDraft['kind']): number => drafts.filter((d) => d.kind === kind).length;
  const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
  const summary = [count('style') && plural(count('style'), 'style'), count('move') && plural(count('move'), 'move')].filter(Boolean).join(' and ');
  const label = keep.length === 0 ? 'Drop all' : keep.length === drafts.length ? `Save all ${drafts.length}` : `Save ${keep.length}, drop ${drafts.length - keep.length}`;

  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section role="dialog" aria-label="New styles and moves" className="drafts">
        <header>
          <h2>Save to your library?</h2>
          <span className="spacer" />
          <button className="ghost" aria-label="Decide later" title="Decide later" onClick={onClose}><X size={16} /></button>
        </header>
        <p className="description">Claude made {summary}. Untick what you don’t want, then save the rest.</p>
        <ul className="body draft-list">
          {drafts.map((draft) => {
            const kept = keep.includes(draft.name);
            return (
              <li key={draft.name} className={kept ? '' : 'dropped'}>
                {draft.example ? <video src={draft.example} controls preload="metadata" muted /> : <div className="no-example">No example clip</div>}
                <div className="draft-text">
                  <label className="draft-pick">
                    <input type="checkbox" checked={kept} onChange={() => toggle(draft.name)} />
                    <strong>{draft.title}</strong>
                    <span className="tag">{draft.kind === 'move' ? 'Move' : 'Style'}</span>
                    {draft.replaces && <span className="tag warn" title="Saving this replaces the one in your library (the old one goes to the Trash)">Replaces yours</span>}
                  </label>
                  <span className="description">{draft.description}</span>
                  {draft.tags.length > 0 && <span className="hint">{draft.tags.join(' · ')}</span>}
                  {draft.source && <span className="hint">Learned from {draft.source}</span>}
                  <details>
                    <summary>Instructions</summary>
                    <pre>{draft.instructions}</pre>
                  </details>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="row">
          <button className="ghost" onClick={() => setKeep(keep.length === drafts.length ? [] : drafts.map((d) => d.name))}>{keep.length === drafts.length ? 'Untick all' : 'Tick all'}</button>
          <span className="spacer" />
          <button onClick={onClose}>Decide later</button>
          <button className="primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : label}</button>
        </div>
      </section>
    </div>
  );
}
