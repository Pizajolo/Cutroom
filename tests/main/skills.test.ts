import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, open, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SkillsService } from '@main/skills/service';
import { CompositionsService } from '@main/compositions/service';
import type { ProjectSession } from '@shared/schema/project';
import type { VideoSkill } from '@shared/schema/skills';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const request = { name: 'My reusable format', description: 'A general story structure', instructions: 'Start with a hook, explain one idea, and close with a summary.' };
async function setup() {
  const root = await mkdtemp(path.join(process.env.TMPDIR ?? tmpdir(), 'cutroom-skills-')); roots.push(root);
  const home = path.join(root, 'home'); let project = path.join(root, 'first'); await mkdir(path.join(project, 'compositions'), { recursive: true });
  const events: VideoSkill[][] = []; const baseUrl = 'http://127.0.0.1:1234/k/first/'; const templates = path.resolve('src/compositions');
  const current = () => ({ rootPath: project } as ProjectSession);
  const skills = new SkillsService({ home, builtinRoot: path.resolve('resources/skills'), baseUrl, current, changed: (items) => events.push(items) });
  const compositions = new CompositionsService({ root: templates, baseUrl, current, skillRoot: (id) => skills.root(id) });
  return { root, home, skills, compositions, events, baseUrl, current, templates, switchProject: async () => { project = path.join(root, 'second'); await mkdir(path.join(project, 'compositions'), { recursive: true }); return project; } };
}
it('ships four reusable instruction-only video types and supports user CRUD with changed events', async () => {
  const env = await setup(); const builtins = await env.skills.list();
  expect(builtins.map((skill) => skill.id)).toEqual(['podcast-clip', 'product-teaser', 'talking-head-short', 'youtube-explainer']); expect(builtins.every((skill) => skill.source === 'builtin' && !('instructions' in skill))).toBe(true);
  for (const builtin of builtins) expect((await env.skills.get(builtin.id)).instructions.length).toBeGreaterThan(50);
  const first = await env.skills.save(request); expect(first).toMatchObject({ id: 'my-reusable-format', source: 'user', compositions: [] }); expect(env.events).toHaveLength(1);
  expect((await env.skills.save(request)).id).toBe('my-reusable-format-2');
  const edited = await env.skills.save({ ...request, id: first.id, instructions: 'Updated pacing and typography guidance.' }); expect(edited.instructions).toBe('Updated pacing and typography guidance.'); expect(env.events.at(-1)?.find((skill) => skill.id === first.id)).toBeTruthy();
  await expect(env.skills.delete(first.id)).resolves.toEqual({ ok: true }); await expect(env.skills.get(first.id)).rejects.toMatchObject({ code: 'not_found' }); expect(env.events).toHaveLength(4);
});
it('refuses built-in updates, deletes, inferred collisions and path traversal without changing existing instructions', async () => {
  const env = await setup(); const before = await readFile(path.resolve('resources/skills/podcast-clip/SKILL.md'), 'utf8');
  await expect(env.skills.save({ ...request, id: 'podcast-clip' })).rejects.toMatchObject({ code: 'forbidden' }); await expect(env.skills.save({ ...request, name: 'Podcast clip' })).rejects.toMatchObject({ code: 'forbidden' }); await expect(env.skills.delete('podcast-clip')).rejects.toMatchObject({ code: 'forbidden' });
  for (const id of ['../escape', '/absolute', 'skills-backup/escape']) { await expect(env.skills.get(id)).rejects.toThrow(); await expect(env.skills.save({ ...request, id })).rejects.toThrow(); await expect(env.skills.delete(id)).rejects.toThrow(); }
  expect(await readFile(path.resolve('resources/skills/podcast-clip/SKILL.md'), 'utf8')).toBe(before); expect(env.events).toEqual([]); expect(await readdir(path.join(env.home, 'skills'))).toEqual([]);
});
it('saves an actual composition as a portable skill, applies in a second project with a new launch URL, and checks it', async () => {
  const env = await setup(); const created = await env.compositions.create('title-card', 'opener'); expect(await env.compositions.check(created.name)).toEqual({ ok: true, violations: [] });
  const entry = path.join(env.current().rootPath, 'compositions/opener/index.html');
  await writeFile(entry, (await readFile(entry, 'utf8')).replace('cutroom:gsap', `${env.baseUrl}runtime/gsap.min.js`));
  const original = await readFile(entry, 'utf8'); expect(original).toContain(env.baseUrl);
  const saved = await env.skills.save(request, ['opener']); expect(saved.compositions).toEqual(['opener']);
  const portable = await readFile(path.join(env.home, `skills/${saved.id}/compositions/opener/index.html`), 'utf8'); expect(portable).toContain('__CUTROOM_COMP_BASE__'); expect(portable).not.toContain(env.baseUrl);
  await env.skills.save({ ...request, id: saved.id, instructions: 'General instructions, revised.' }); expect((await env.skills.get(saved.id)).compositions).toEqual(['opener']);
  const second = await env.switchProject(); const baseUrl = 'http://127.0.0.1:5678/k/second/'; const compositions = new CompositionsService({ root: env.templates, baseUrl, current: env.current, skillRoot: (id) => env.skills.root(id) });
  expect((await compositions.createFromSkill(saved.id, 'opener', 'opener')).name).toBe('opener'); expect((await compositions.createFromSkill(saved.id, 'opener', 'opener')).name).toBe('opener-2');
  expect(await compositions.check('opener')).toEqual({ ok: true, violations: [] }); const applied = await readFile(path.join(second, 'compositions/opener/index.html'), 'utf8'); expect(applied).toContain(baseUrl); expect(applied).not.toContain(env.baseUrl); expect(applied).not.toContain('__CUTROOM_COMP_BASE__');
  expect(original).toBe(await readFile(path.join(env.root, 'first/compositions/opener/index.html'), 'utf8'));
});
it('rejects a symlinked user skill independently of slug validation and preserves the outside target', async () => {
  const env = await setup(); await env.skills.list(); const outside = path.join(env.root, 'skills-backup'); await mkdir(outside); await writeFile(path.join(outside, 'SKILL.md'), 'outside sentinel'); await symlink(outside, path.join(env.home, 'skills/valid-name'));
  await expect(env.skills.get('valid-name')).rejects.toThrow(); await expect(env.skills.delete('valid-name')).rejects.toThrow(); await expect(env.skills.save({ ...request, id: 'valid-name' })).rejects.toThrow(); expect(await readFile(path.join(outside, 'SKILL.md'), 'utf8')).toBe('outside sentinel'); expect(env.events).toEqual([]);
});
it('rejects nested composition links on save and apply, removes only partial destinations, and leaves source bytes unchanged', async () => {
  const env = await setup(); await env.compositions.create('title-card', 'opener'); const source = path.join(env.current().rootPath, 'compositions/opener'); const before = await readFile(path.join(source, 'index.html'), 'utf8'); const sentinel = path.join(env.root, 'source-media'); await writeFile(sentinel, 'original media'); await symlink(sentinel, path.join(source, 'linked-media'));
  await expect(env.skills.save(request, ['opener'])).rejects.toThrow(); expect(await readdir(path.join(env.home, 'skills'))).toEqual([]); expect(await readFile(sentinel, 'utf8')).toBe('original media'); expect(await readFile(path.join(source, 'index.html'), 'utf8')).toBe(before);
  await rm(path.join(source, 'linked-media')); const saved = await env.skills.save(request, ['opener']); await symlink(sentinel, path.join(env.home, `skills/${saved.id}/compositions/opener/linked-media`)); await env.switchProject();
  await expect(env.compositions.createFromSkill(saved.id, 'opener', 'opener')).rejects.toThrow(); expect(await readdir(path.join(env.current().rootPath, 'compositions'))).toEqual([]); expect(await readFile(sentinel, 'utf8')).toBe('original media');
});
it('enforces the cumulative composition byte cap before publication and cleans staging', async () => {
  const env = await setup(); await env.compositions.create('title-card', 'opener'); const large = path.join(env.current().rootPath, 'compositions/opener/large.bin'); const file = await open(large, 'wx'); try { await file.truncate(50 * 1024 * 1024 + 1); } finally { await file.close(); }
  await expect(env.skills.save(request, ['opener'])).rejects.toMatchObject({ code: 'invalid_request' }); expect(await readdir(path.join(env.home, 'skills'))).toEqual([]); expect(env.events).toEqual([]);
});
it('rejects malformed or aliased frontmatter and oversized instructions without publishing a skill', async () => {
  const env = await setup(); const saved = await env.skills.save(request); const markdown = path.join(env.home, `skills/${saved.id}/SKILL.md`); await writeFile(markdown, 'no frontmatter'); await expect(env.skills.get(saved.id)).rejects.toMatchObject({ code: 'invalid_request' });
  await writeFile(markdown, '---\nname: &n Title\ndescription: *n\n---\nInstructions'); await expect(env.skills.get(saved.id)).rejects.toThrow(); await expect(env.skills.save({ ...request, id: 'too-large', instructions: 'x'.repeat(100001) })).rejects.toThrow(); expect((await readdir(path.join(env.home, 'skills'))).sort()).toEqual([saved.id]);
});
