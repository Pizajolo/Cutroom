import { useState } from 'react';
import type { ReactNode } from 'react';
import type { Skill } from '../shared/types';
import { UTILITY_SKILLS } from '../shared/types';

const KINDS = [['', 'All'], ['style', 'Styles'], ['move', 'Moves']] as const;

/** Filter the library by kind, text and tags. Returns the matching entries, favourites first, and the controls to show above them. */
export function useLibraryFilter(skills: Skill[]): [Skill[], ReactNode] {
  const [kind, setKind] = useState<'' | Skill['kind']>('');
  const [search, setSearch] = useState('');
  const [tags, setTags] = useState<string[]>([]);

  const all = skills.filter((skill) => !UTILITY_SKILLS.includes(skill.id));
  const ofKind = all.filter((skill) => !kind || skill.kind === kind);
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const visible = ofKind
    .filter(
      (skill) =>
        tags.every((tag) => skill.tags.includes(tag)) &&
        words.every((word) => `${skill.name} ${skill.description} ${skill.tags.join(' ')} ${skill.source ?? ''}`.toLowerCase().includes(word)),
    )
    .sort((a, b) => Number(b.favorite) - Number(a.favorite)); // stable: the rest keeps its order
  // Offer the most used tags of what is listed; chosen ones always stay visible. Search finds the rest.
  const counts = new Map<string, number>();
  for (const tag of ofKind.flatMap((skill) => skill.tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  const offered = [...new Set([...tags, ...[...counts.keys()].sort((a, b) => counts.get(b)! - counts.get(a)!)])].slice(0, Math.max(14, tags.length));
  const toggle = (tag: string): void => setTags(tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag]);

  const controls = (
    <div className="library-filter">
      <div className="row">
        <div className="switch" role="tablist" aria-label="Kind">
          {KINDS.map(([value, label]) => (
            <button type="button" key={value} role="tab" aria-selected={kind === value} onClick={() => setKind(value)}>{label}</button>
          ))}
        </div>
        <input className="grow" type="search" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {offered.length > 0 && (
        <div className="tags">
          {offered.map((tag) => (
            <button type="button" key={tag} className={tags.includes(tag) ? 'tag on' : 'tag'} aria-pressed={tags.includes(tag)} onClick={() => toggle(tag)}>{tag}</button>
          ))}
        </div>
      )}
    </div>
  );
  return [visible, controls];
}
