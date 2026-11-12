// Per-project choices (.cutroom/project.json) and the links between styles and the videos made with them.
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { cutFiles } from '../shared/types';
import type { Cut, LedgerEntry, Timeline, Version } from '../shared/types';
import { HOME, run } from './run';

/** The user's own styles: a Claude Code plugin folder. */
export const LIBRARY = path.join(HOME, 'library');
const VIDEOS = path.join(LIBRARY, 'videos.json');

export interface ProjectSettings {
  model?: string;
  /** Features switched off just here. */
  off?: string[];
  /** Styles (skill ids) this project's video was made or saved with. */
  styles?: string[];
  /** The cut the user is working on. */
  cut?: string;
}
const projectFile = (root: string): string => path.join(root, '.cutroom/project.json');
export const readProject = async (root: string): Promise<ProjectSettings> =>
  JSON.parse(await readFile(projectFile(root), 'utf8').catch(() => '{}')) as ProjectSettings;
export const patchProject = async (root: string, patch: ProjectSettings): Promise<void> =>
  writeFile(projectFile(root), JSON.stringify({ ...(await readProject(root)), ...patch }, null, 2));

// --- Cuts: one chat and one edit each, on the same footage ------------------------------------

const cutsFile = (root: string): string => path.join(root, '.cutroom/cuts.json');
export const readCuts = async (root: string): Promise<Cut[]> =>
  JSON.parse(await readFile(cutsFile(root), 'utf8').catch(() => '[]')) as Cut[];
export const writeCuts = (root: string, cuts: Cut[]): Promise<void> => writeFile(cutsFile(root), JSON.stringify(cuts, null, 2));

/**
 * The cut a command works on: the agent's own (CUTROOM_CUT, set for each session), else the one open in the app.
 * Projects from before cuts existed have none yet; the app moves their edit into "main" when it opens them.
 */
export async function activeCut(root: string): Promise<string> {
  const cuts = await readCuts(root);
  const wanted = process.env.CUTROOM_CUT ?? (await readProject(root)).cut;
  return cuts.find((c) => c.id === wanted)?.id ?? cuts[0]?.id ?? 'main';
}

const FAVORITES = path.join(LIBRARY, 'favorites.json');
/** Ids of the styles and moves the user starred. */
export const readFavorites = async (): Promise<string[]> => JSON.parse(await readFile(FAVORITES, 'utf8').catch(() => '[]')) as string[];
export async function toggleFavorite(id: string): Promise<void> {
  const favorites = await readFavorites();
  await mkdir(LIBRARY, { recursive: true });
  await writeFile(FAVORITES, JSON.stringify(favorites.includes(id) ? favorites.filter((f) => f !== id) : [...favorites, id]));
}

/** Remember that this project uses a style, so its exports are listed under it. */
export async function useStyle(root: string, id: string): Promise<void> {
  const styles = (await readProject(root)).styles ?? [];
  if (!styles.includes(id)) await patchProject(root, { styles: [...styles, id] });
}

/** Exported videos per style id; files that have since been moved or deleted are left out. */
export async function styleVideos(): Promise<Record<string, string[]>> {
  const all = JSON.parse(await readFile(VIDEOS, 'utf8').catch(() => '{}')) as Record<string, string[]>;
  return Object.fromEntries(Object.entries(all).map(([id, files]) => [id, files.filter((file) => existsSync(file))]));
}

/** Take one video off a style's list. The file itself is not touched. */
export async function unlinkVideo(id: string, file: string): Promise<void> {
  const videos = await styleVideos();
  await writeFile(VIDEOS, JSON.stringify({ ...videos, [id]: (videos[id] ?? []).filter((f) => f !== file) }, null, 2));
}

/** List a fresh export under every style its project uses. */
export async function linkExport(root: string, file: string): Promise<void> {
  const styles = (await readProject(root)).styles ?? [];
  if (!styles.length) return;
  const videos = await styleVideos();
  for (const id of styles) videos[id] = [...(videos[id] ?? []), file];
  await mkdir(LIBRARY, { recursive: true });
  await writeFile(VIDEOS, JSON.stringify(videos, null, 2));
}

/**
 * Keep an example video next to a style or move, and link the project to it.
 * Without `clip` it is the whole current preview; with it, a section of the preview or of another file (`src`).
 */
export async function saveExample(root: string, cut: string, name: string, clip: { src?: string; from?: number; to?: number } = {}): Promise<string> {
  const dir = path.join(LIBRARY, 'skills', name);
  if (!/^[\w-]+$/.test(name) || !existsSync(path.join(dir, 'SKILL.md'))) throw new Error(`No style or move called "${name}" in the library. Write its SKILL.md first.`);
  const source = path.resolve(root, clip.src ?? cutFiles(cut).preview);
  const out = path.join(dir, 'example.mp4');
  if (clip.from === undefined && clip.to === undefined && !clip.src) await copyFile(source, out);
  else {
    const range = [...(clip.from !== undefined ? ['-ss', String(clip.from)] : []), ...(clip.to !== undefined ? ['-to', String(clip.to)] : [])];
    await run('ffmpeg', ['-v', 'error', '-y', ...range, '-i', source, '-vf', "scale='min(540,iw)':-2", '-c:v', 'libx264', '-crf', '26', '-pix_fmt', 'yuv420p', '-c:a', 'aac', out]);
  }
  // Only the user's own edit makes this project "made with" the style; a clip of a reference does not.
  if (!clip.src) await useStyle(root, `my:${name}`);
  return out;
}

// --- Versions: every step that changed a cut's edit, and every export -----------------------

const versionsFile = (root: string, cut: string): string => path.join(root, cutFiles(cut).versions);
export const readVersions = async (root: string, cut: string): Promise<Version[]> =>
  JSON.parse(await readFile(versionsFile(root, cut), 'utf8').catch(() => '[]')) as Version[];

/** Record the edit as a new version, unless nothing changed since the last one. Exports (`file`) are always recorded. */
export async function addVersion(root: string, cut: string, label: string, timeline: Timeline, file?: string): Promise<Version[]> {
  const versions = await readVersions(root, cut);
  const last = versions.at(-1);
  if (!file && last && JSON.stringify(last.timeline) === JSON.stringify(timeline)) return versions;
  versions.push({ id: (last?.id ?? 0) + 1, at: new Date().toISOString(), label, timeline, file });
  await writeFile(versionsFile(root, cut), JSON.stringify(versions));
  return versions;
}

/** Mark one version as the final one (or clear the mark if it already is). */
export async function markFinal(root: string, cut: string, id: number): Promise<Version[]> {
  const versions = (await readVersions(root, cut)).map((v) => ({ ...v, final: v.id === id && !v.final ? true : undefined }));
  await writeFile(versionsFile(root, cut), JSON.stringify(versions));
  return versions;
}

// --- Sources and rights: where everything that was not shot by the user came from ------------

const ledgerFile = (root: string): string => path.join(root, '.cutroom/ledger.json');
export const readLedger = async (root: string): Promise<LedgerEntry[]> =>
  JSON.parse(await readFile(ledgerFile(root), 'utf8').catch(() => '[]')) as LedgerEntry[];

export async function addLedger(root: string, entry: LedgerEntry): Promise<void> {
  const others = (await readLedger(root)).filter((e) => e.file !== entry.file);
  await writeFile(ledgerFile(root), JSON.stringify([...others, entry], null, 2));
}
