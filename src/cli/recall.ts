// `cutroom recall`: find the moves in the user's library that fit each shot of a storyboard.
// The words of each beat are matched against every move's name, tags, description and instructions. The editor (the
// agent) still decides what fits: this only narrows a growing library down to a few candidates per shot, says why each
// came up, and marks moves used in the last few projects so videos don't all look the same.
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { UTILITY_SKILLS } from '../shared/types';
import { LIBRARY, readFavorites, readProject } from './project';
import { HOME } from './run';

const BUILTIN = path.resolve(import.meta.dirname, '../../skills');
const MARKET = path.join(HOME, 'market');
const RECENTS = path.join(HOME, 'recents.json');

interface Entry {
  id: string;
  name: string;
  kind: 'style' | 'move';
  description: string;
  tags: string[];
  source?: string;
  body: string;
  example?: string;
  favorite: boolean;
}

const STOP = new Set(
  ('the a an and or but of to in on at for with from by as is are was were be been it its this that these those i you we they he she ' +
    'my your our their me us them so then than very just about into over under up down out off can will would should could do does did ' +
    'have has had not no yes all any each some more most one two what when where which who why how there here also only like get gets ' +
    'say says said see seen show shows shown make makes made video shot scene beat moment part viewer user frame need needs use used using edit editing learn').split(' '),
);

/** Editing words that mean the same move. A beat that says "zoom" should find the punch-in. */
const SYNONYMS: string[][] = [
  ['zoom', 'punch', 'push', 'crop', 'closer', 'emphasis', 'emphasise', 'emphasize'],
  ['caption', 'subtitle', 'words', 'word', 'karaoke', 'transcript'],
  ['title', 'headline', 'heading', 'kinetic', 'typography', 'text', 'statement'],
  ['logo', 'brand', 'end', 'outro', 'endcard', 'cta', 'follow'],
  ['cutout', 'subject', 'sticker', 'background', 'behind', 'outline'],
  ['transition', 'whip', 'swipe', 'wipe', 'crossfade', 'dissolve'],
  ['list', 'three', 'steps', 'checklist', 'tips', 'reasons', 'points', 'name', 'names'],
  ['number', 'stat', 'stats', 'count', 'counter', 'price', 'percent', 'data', 'chart'],
  ['product', 'packshot', 'reveal', 'unbox', 'feature', 'teaser'],
  ['sound', 'sfx', 'whoosh', 'pop', 'click', 'hit', 'impact', 'riser'],
  ['broll', 'b-roll', 'cutaway', 'footage', 'insert', 'overlay'],
  ['split', 'compare', 'comparison', 'before', 'after', 'versus', 'side'],
  ['hook', 'opening', 'intro', 'start', 'first'],
  ['montage', 'sequence', 'beats', 'rhythm', 'music', 'fast'],
  ['speaker', 'talking', 'face', 'head', 'person', 'camera'],
];
const GROUP = new Map<string, number>();
SYNONYMS.forEach((group, i) => group.forEach((word) => GROUP.set(stem(word), i)));

function stem(word: string): string {
  let w = word.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (w.length > 4 && /(ss|x|z|ch|sh)es$/.test(w)) w = w.slice(0, -2); // "boxes" → "box"
  else if (w.length > 6 && w.endsWith('ing')) w = w.slice(0, -3);
  else if (w.length > 5 && w.endsWith('ed')) w = w.slice(0, -2);
  else if (w.length > 5 && w.endsWith('ly')) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1); // "prices" → "price"
  w = w.replace(/e$/, ''); // "price" and "pric(ing)" meet
  return w.replace(/([^aeiou])\1$/, '$1'); // "zooming" → "zoom", "popping" → "pop"
}

const words = (text: string): string[] =>
  text.toLowerCase().replace(/b-roll/g, 'broll').split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)).map(stem);

/** Every style and move Cutroom can load: built in, the user's own, and installed from the marketplace. */
async function readLibrary(): Promise<Entry[]> {
  const favorites = await readFavorites();
  const entries: Entry[] = [];
  for (const [plugin, root] of [['cutroom', BUILTIN], ['my', LIBRARY], ['market', MARKET]] as const) {
    const dir = path.join(root, 'skills');
    for (const name of existsSync(dir) ? await readdir(dir) : []) {
      const text = await readFile(path.join(dir, name, 'SKILL.md'), 'utf8').catch(() => '');
      if (!text) continue;
      const id = `${plugin}:${name}`;
      if (UTILITY_SKILLS.includes(id)) continue;
      const field = (key: string): string => new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(text)?.[1]?.trim() ?? '';
      const example = ['example.mp4', 'example.mov', 'example.webm'].map((f) => path.join(dir, name, f)).find((f) => existsSync(f));
      entries.push({
        id,
        name: field('name') || name,
        kind: field('kind') === 'move' ? 'move' : 'style',
        description: field('description'),
        tags: field('tags').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean),
        source: field('source') || undefined,
        body: text.replace(/^---[\s\S]*?---/, ''),
        example,
        favorite: favorites.includes(id),
      });
    }
  }
  return entries;
}

/** Skill ids used by each of the most recent other projects, newest first. */
async function recentUse(root: string, count: number): Promise<{ name: string; styles: string[] }[]> {
  const recents = JSON.parse(await readFile(RECENTS, 'utf8').catch(() => '[]')) as { root: string; name: string }[];
  const others = recents.filter((p) => path.resolve(p.root) !== path.resolve(root)).slice(0, count);
  return Promise.all(others.map(async (p) => ({ name: p.name, styles: (await readProject(p.root).catch(() => ({ styles: [] }))).styles ?? [] })));
}

interface Hit {
  entry: Entry;
  score: number;
  matched: string[];
}

function rank(entries: Entry[], query: string): Hit[] {
  const fields = entries.map((e) => ({
    name: new Set(words(`${e.name} ${e.id.split(':')[1]}`.replace(/-/g, ' '))),
    tags: new Set(e.tags.flatMap(words)),
    description: new Set(words(e.description)),
    body: new Set(words(e.body)),
  }));
  const all = fields.map((f) => new Set([...f.name, ...f.tags, ...f.description, ...f.body]));
  const idf = (term: string): number => Math.log(1 + entries.length / (1 + all.filter((s) => s.has(term)).length));
  const terms = [...new Set(words(query))];
  return entries
    .map((entry, i) => {
      const f = fields[i]!;
      let score = 0;
      let direct = 0;
      const matched: string[] = [];
      for (const term of terms) {
        const weight = (t: string): number => (f.name.has(t) ? 3 : 0) + (f.tags.has(t) ? 2.5 : 0) + (f.description.has(t) ? 1.5 : 0) + (f.body.has(t) ? 0.4 : 0);
        let s = weight(term) * idf(term);
        if (s > 0) direct++;
        // A synonym counts half: "zoom" finds a move about punching in.
        const group = GROUP.get(term);
        if (!s && group !== undefined) {
          const near = SYNONYMS[group]!.map(stem).filter((t) => t !== term && weight(t) > 0);
          if (near.length) s = (0.5 * Math.max(...near.map((t) => weight(t) * idf(t))));
        }
        if (s > 0) {
          score += s;
          matched.push(term);
        }
      }
      // Synonyms alone are too loose ("whoosh" is a sound, the "pop" in a move's name may be visual).
      return { entry, score: direct ? score * (entry.favorite ? 1.15 : 1) : 0, matched };
    })
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score);
}

/**
 * Candidates for each beat of a storyboard (moves), or for a whole brief (`styles`: styles too).
 * Moves used in the last `recent` other projects rank lower and say where they were used.
 */
export async function recall(root: string, opts: { beats: string[]; limit?: number; recent?: number; styles?: boolean; exclude?: string[] }): Promise<string> {
  const library = await readLibrary();
  const exclude = new Set((opts.exclude ?? []).map((x) => x.replace(/^@/, '')));
  const candidates = library.filter((e) => (opts.styles || e.kind === 'move') && !exclude.has(e.name) && !exclude.has(e.id) && !exclude.has(e.id.split(':')[1]!));
  if (!candidates.length) return 'The library has no moves yet: design each move yourself and label it new.';
  const recent = await recentUse(root, opts.recent ?? 5);
  const here = new Set((await readProject(root)).styles ?? []);
  const limit = opts.limit ?? 3;
  const best = opts.beats.map((beat) => {
    const hits = rank(candidates, beat).map((h) => {
      const usedIn = recent.filter((p) => p.styles.includes(h.entry.id)).map((p) => p.name);
      return { ...h, usedIn, score: here.has(h.entry.id) ? h.score : h.score * (usedIn.length ? 0.6 : 1) };
    });
    // Weak matches (one common word in the instructions) are noise; nothing is better than a wrong pick.
    return hits.sort((a, b) => b.score - a.score).filter((h) => h.score >= 1.5).slice(0, limit);
  });
  const lines: string[] = [];
  for (const [i, beat] of opts.beats.entries()) {
    lines.push(`${opts.beats.length > 1 ? `Beat ${i + 1}: ` : ''}${beat}`);
    const hits = best[i]!;
    if (!hits.length) lines.push('  Nothing in the library fits: design the move and label it new.');
    for (const h of hits) {
      const e = h.entry;
      const where = e.id.startsWith('my:') ? 'yours' : e.id.startsWith('market:') ? 'marketplace' : 'built in';
      const others = best.flatMap((b, j) => (j !== i && b[0]?.entry.id === e.id ? [j + 1] : []));
      lines.push(`  @${e.name} (${e.id}, ${e.kind}, ${where}${e.favorite ? ', starred' : ''}) score ${h.score.toFixed(1)} — ${e.description}`);
      lines.push(
        `    matched: ${h.matched.join(', ')}` +
          (here.has(e.id) ? ' · already used in this project' : '') +
          (h.usedIn.length ? ` · used recently in ${h.usedIn.join(', ')}` : '') +
          (others.length ? ` · also the top pick for beat ${others.join(', ')}` : '') +
          (e.source ? ` · learned from ${e.source}` : '') +
          (e.example ? ` · example: ${e.example}` : ''),
      );
    }
  }
  lines.push('', 'Load a move with the Skill tool and look at its example before you borrow it. Borrow only what serves the beat.');
  return lines.join('\n');
}
