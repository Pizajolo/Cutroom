// New styles and moves Claude saved: drafts until the user keeps or drops each one in the review popup.
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { shell } from 'electron';
import { DRAFTS, DRAFT_INFO, LIBRARY, useStyle } from '../cli/project';
import type { DraftInfo } from '../cli/project';
import { cleanFrontmatter, frontmatterField } from '../shared/frontmatter';
import type { SkillDraft } from '../shared/types';

const NAME = /^[\w-]+$/;
const SKILLS = path.join(LIBRARY, 'skills');

const readInfo = async (dir: string): Promise<DraftInfo | undefined> =>
  JSON.parse(await readFile(path.join(dir, DRAFT_INFO), 'utf8').catch(() => 'null')) ?? undefined;

/** Every draft waiting for the user, styles first. */
export async function listDrafts(): Promise<SkillDraft[]> {
  if (!existsSync(DRAFTS)) return [];
  const drafts: SkillDraft[] = [];
  for (const name of await readdir(DRAFTS)) {
    const dir = path.join(DRAFTS, name);
    const instructions = NAME.test(name) ? await readFile(path.join(dir, 'SKILL.md'), 'utf8').catch(() => '') : '';
    if (!instructions) continue;
    const field = (key: string): string => frontmatterField(instructions, key);
    const info = await readInfo(dir);
    drafts.push({
      name,
      title: field('name') || name,
      kind: field('kind') === 'move' ? 'move' : 'style',
      description: field('description'),
      tags: field('tags').split(',').map((tag) => tag.trim().toLowerCase()).filter(Boolean),
      source: field('source') || undefined,
      instructions,
      example: existsSync(path.join(dir, 'example.mp4')) ? `media://draft/${name}/example.mp4` : undefined,
      replaces: existsSync(path.join(SKILLS, name, 'SKILL.md')),
      project: info?.root ? path.basename(info.root) : undefined,
    });
  }
  return drafts.sort((a, b) => (a.kind === b.kind ? a.title.localeCompare(b.title) : a.kind === 'style' ? -1 : 1));
}

/** Trash rather than delete: a wrong click can be undone from the Trash. */
const discard = (dir: string): Promise<void> => shell.trashItem(dir).catch(() => rm(dir, { recursive: true, force: true }));

/** Move the kept drafts into the library (replacing an entry of the same name) and throw the dropped ones away. */
export async function settleDrafts(keep: string[], drop: string[]): Promise<void> {
  await mkdir(SKILLS, { recursive: true });
  for (const name of keep.filter((n) => NAME.test(n))) {
    const dir = path.join(DRAFTS, name);
    const file = path.join(dir, 'SKILL.md');
    if (!existsSync(file)) continue;
    await writeFile(file, cleanFrontmatter(await readFile(file, 'utf8')));
    const info = await readInfo(dir);
    await rm(path.join(dir, DRAFT_INFO), { force: true });
    const dest = path.join(SKILLS, name);
    if (existsSync(dest)) await discard(dest);
    await rename(dir, dest);
    // The project it was saved from now counts as made with it, so its exports are listed under it.
    if (info?.linked && existsSync(info.root)) await useStyle(info.root, `my:${name}`).catch(() => {});
  }
  for (const name of drop.filter((n) => NAME.test(n) && !keep.includes(n))) {
    const dir = path.join(DRAFTS, name);
    if (existsSync(dir)) await discard(dir);
  }
}
