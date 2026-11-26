// Free fonts for brand kits: everything in Fontsource's index (Google Fonts and other open-licensed families) can be
// looked up and downloaded into a kit as a real .ttf, so graphics, captions (FFmpeg) and exports never depend on
// what is installed or online. Paid fonts are not in it: those the user uploads.
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { HOME } from '../cli/run';
import type { BrandFont } from '../shared/brand';
import type { FontLookup } from '../shared/types';

const API = 'https://api.fontsource.org/v1/fonts';
const INDEX = path.join(HOME, 'fonts-index.json');
const WEEK = 7 * 24 * 3600 * 1000;

interface Entry { id: string; family: string; weights: number[]; styles: string[]; category: string; license: string; type: string; defSubset: string }
let index: Entry[] | null = null;

const get = async (url: string): Promise<Response> => {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`${response.status} from ${new URL(url).host}`);
  return response;
};

/** Every free family, from a copy refreshed weekly (the old copy when offline). */
async function families(): Promise<Entry[]> {
  if (index) return index;
  const age = await stat(INDEX).then((s) => Date.now() - s.mtimeMs, () => Infinity);
  if (age > WEEK) {
    try {
      const text = await (await get(API)).text();
      JSON.parse(text);
      await mkdir(HOME, { recursive: true });
      await writeFile(INDEX, text);
    } catch (error) {
      if (!existsSync(INDEX)) throw new Error(`The list of free fonts could not be loaded (${(error as Error).message}). Are you online?`);
    }
  }
  return (index = JSON.parse(await readFile(INDEX, 'utf8')) as Entry[]);
}

const squash = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');
/** Edit distance, for "did you mean". */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const next = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = row[j]!;
      row[j] = next;
    }
  }
  return row[b.length]!;
}

/** Well-known paid typefaces and the free ones designers usually reach for instead. */
const LOOKALIKES: Record<string, string[]> = {
  helvetica: ['Inter', 'Arimo'], helveticaneue: ['Inter', 'Arimo'], arial: ['Arimo', 'Inter'], futura: ['Jost', 'League Spartan'],
  gotham: ['Montserrat', 'Figtree'], proximanova: ['Montserrat', 'Figtree'], avenir: ['Nunito Sans', 'Figtree'], avenirnext: ['Nunito Sans', 'Figtree'],
  gillsans: ['Lato', 'Cabin'], circular: ['DM Sans', 'Outfit'], graphik: ['Inter', 'Manrope'], gtwalsheim: ['DM Sans', 'Outfit'],
  sofiapro: ['Outfit', 'Figtree'], brandongrotesque: ['Josefin Sans', 'Raleway'], neuehaasgrotesk: ['Inter', 'Hanken Grotesk'], sfpro: ['Inter', 'Figtree'],
  garamond: ['EB Garamond', 'Cormorant Garamond'], adobegaramond: ['EB Garamond', 'Cormorant Garamond'], didot: ['Playfair Display', 'Bodoni Moda'],
  bodoni: ['Bodoni Moda', 'Libre Bodoni'], baskerville: ['Libre Baskerville'], timesnewroman: ['Tinos', 'Libre Baskerville'], georgia: ['Gelasio'],
  canela: ['Cormorant', 'Playfair Display'], theseasons: ['Cormorant Garamond', 'Playfair Display'], recoleta: ['Fraunces'], copperplate: ['Cinzel'],
  trajan: ['Cinzel'], ogg: ['Cormorant', 'Fraunces'], chronicledisplay: ['Playfair Display', 'Libre Caslon Display'], minionpro: ['Crimson Pro', 'EB Garamond'],
};

const LIBRARY = (e: Entry): string => (e.type === 'google' ? 'Google Fonts' : 'Fontsource');

/** Is this family free to download? If not, the closest names that are. */
export async function lookupFont(family: string): Promise<FontLookup> {
  const wanted = squash(family);
  if (!wanted) return { suggestions: [] };
  const all = await families();
  const hit = all.find((e) => squash(e.family) === wanted);
  if (hit) return { found: { family: hit.family, weights: hit.weights, license: hit.license, library: LIBRARY(hit), category: hit.category }, suggestions: [] };
  const lookalikes = (LOOKALIKES[wanted] ?? []).filter((name) => name && all.some((e) => e.family === name));
  const suggestions = [...lookalikes, ...all
    .map((e) => {
      const name = squash(e.family);
      // A name that starts with what was typed ("playf" → Playfair Display), then contains it, then is spelt alike.
      const score = wanted.length >= 3 && name.startsWith(wanted) ? 0 : wanted.length >= 4 && name.includes(wanted) ? 1 : distance(wanted, name) / Math.max(wanted.length, name.length) + 1;
      return { family: e.family, score };
    })
    .filter((s) => s.score < 1.35)
    .sort((a, b) => a.score - b.score)
    .slice(0, 4)
    .map((s) => s.family)
    .filter((name) => !lookalikes.includes(name))].slice(0, 4);
  return { suggestions, ...(lookalikes.length ? { lookalikes: true } : {}) };
}

/** The weight a family has that is nearest to the one asked for. */
const nearest = (weights: number[], want: number): number => weights.reduce((best, w) => (Math.abs(w - want) < Math.abs(best - want) ? w : best), weights[0] ?? 400);

/**
 * Download one weight of a free family into `dir` as a .ttf. Google families come whole from Google Fonts (every
 * character); the others from Fontsource (their main character set).
 */
export async function downloadFont(dir: string, family: string, weight: number): Promise<{ file: string; source: NonNullable<BrandFont['source']> }> {
  const all = await families();
  const entry = all.find((e) => squash(e.family) === squash(family));
  if (!entry) throw new Error(`${family} is not a free font. Upload the font file, or pick a free one.`);
  const w = nearest(entry.weights, weight);
  let url: string;
  if (entry.type === 'google') {
    const css = await (await get(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(entry.family).replace(/%20/g, '+')}:wght@${w}`)).text();
    const found = /src:\s*url\((https:[^)]+\.ttf)\)/.exec(css)?.[1];
    if (!found) throw new Error(`Google Fonts did not offer a file for ${entry.family} ${w}.`);
    url = found;
  } else {
    const detail = (await (await get(`${API}/${entry.id}`)).json()) as { variants: Record<string, Record<string, Record<string, { url: { ttf?: string } }>>> };
    const found = detail.variants[String(w)]?.normal?.[entry.defSubset]?.url.ttf;
    if (!found) throw new Error(`Fontsource has no file for ${entry.family} ${w}.`);
    url = found;
  }
  const bytes = Buffer.from(await (await get(url)).arrayBuffer());
  const magic = bytes.subarray(0, 4).toString('hex');
  if (!['00010000', '74727565', '4f54544f'].includes(magic)) throw new Error(`What came back for ${entry.family} is not a font file.`);
  await mkdir(dir, { recursive: true });
  const file = `${entry.family.replace(/[^\w]+/g, '')}-${w}.ttf`;
  await writeFile(path.join(dir, file), bytes);
  return { file, source: { library: LIBRARY(entry), license: entry.license, url: entry.type === 'google' ? `https://fonts.google.com/specimen/${entry.family.replace(/ /g, '+')}` : `https://fontsource.org/fonts/${entry.id}`, family: entry.family, weight: w } };
}
