// Per-project choices (.cutroom/project.json) and the links between styles and the videos made with them.
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PREVIEW_FILE } from '../shared/types';
import { HOME } from './run';

/** The user's own styles: a Claude Code plugin folder. */
export const LIBRARY = path.join(HOME, 'library');
const VIDEOS = path.join(LIBRARY, 'videos.json');

export interface ProjectSettings {
  model?: string;
  /** Features switched off just here. */
  off?: string[];
  /** Styles (skill ids) this project's video was made or saved with. */
  styles?: string[];
}
const projectFile = (root: string): string => path.join(root, '.cutroom/project.json');
export const readProject = async (root: string): Promise<ProjectSettings> =>
  JSON.parse(await readFile(projectFile(root), 'utf8').catch(() => '{}')) as ProjectSettings;
export const patchProject = async (root: string, patch: ProjectSettings): Promise<void> =>
  writeFile(projectFile(root), JSON.stringify({ ...(await readProject(root)), ...patch }, null, 2));

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

/** Keep the video a style was distilled from next to it (the current preview render), and link the project to the style. */
export async function saveExample(root: string, name: string): Promise<string> {
  const dir = path.join(LIBRARY, 'skills', name);
  if (!/^[\w-]+$/.test(name) || !existsSync(path.join(dir, 'SKILL.md'))) throw new Error(`No style called "${name}" in the library. Write its SKILL.md first.`);
  await copyFile(path.join(root, PREVIEW_FILE), path.join(dir, 'example.mp4'));
  await useStyle(root, `my:${name}`);
  return path.join(dir, 'example.mp4');
}
