import { randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { contract, IpcFailure, type InvokeReq } from '@shared/ipc/contract';
import { skillIdSchema, videoSkillDetailSchema, videoSkillSchema, type VideoSkill, type VideoSkillDetail } from '@shared/schema/skills';
import { compositionNameSchema } from '@shared/schema/compositions';
import type { ProjectSession } from '@shared/schema/project';
import { atomicWrite, copyTree, isMissing, managedPath, readManaged } from '../fs/managed';
import { managedDirectory } from '../tools/files';

const MAX_BYTES = 50 * 1024 * 1024;
export class SkillsService {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private readonly options: { home: string; builtinRoot: string; baseUrl: string; current: () => ProjectSession; changed: (skills: VideoSkill[]) => void }) {}
  private async userRoot(): Promise<string> { return managedDirectory(this.options.home, 'skills'); }
  private async exists(root: string, id: string): Promise<boolean> {
    try { const info = await lstat(await managedPath(root, skillIdSchema.parse(id))); if (!info.isDirectory()) throw new IpcFailure({ code: 'forbidden', message: 'Skill folders must be real directories.' }); return true; }
    catch (error) { if (isMissing(error)) return false; throw error; }
  }
  private async isBuiltin(id: string): Promise<boolean> {
    try { return await this.exists(this.options.builtinRoot, id); } catch (error) { if (isMissing(error)) return false; throw error; }
  }
  async root(input: string): Promise<string> {
    const id = skillIdSchema.parse(input);
    const root = await this.isBuiltin(id) ? this.options.builtinRoot : await this.userRoot();
    if (!await this.exists(root, id)) throw new IpcFailure({ code: 'not_found', message: 'Video type not found.' });
    return managedPath(root, id);
  }
  async get(input: string): Promise<VideoSkillDetail> {
    const id = skillIdSchema.parse(input); const root = await this.root(id);
    const text = await readManaged(root, 'SKILL.md', 512 * 1024);
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/u.exec(text);
    if (!match) throw new IpcFailure({ code: 'invalid_request', message: 'The skill needs YAML frontmatter and instructions.' });
    const meta: unknown = parse(match[1]!, { maxAliasCount: 0 });
    const fields = videoSkillSchema.pick({ name: true, description: true }).parse(meta);
    const compositions: string[] = [];
    try {
      const templates = await managedPath(root, 'compositions');
      for (const entry of await readdir(templates, { withFileTypes: true })) {
        if (entry.isSymbolicLink() || !entry.isDirectory()) throw new IpcFailure({ code: 'forbidden', message: 'Skill compositions must be real folders.' });
        compositions.push(compositionNameSchema.parse(entry.name));
      }
    } catch (error) { if (!isMissing(error)) throw error; }
    return videoSkillDetailSchema.parse({ id, ...fields, source: await this.isBuiltin(id) ? 'builtin' : 'user', compositions: compositions.sort(), instructions: match[2], updatedAt: (await lstat(await managedPath(root, 'SKILL.md'))).mtime.toISOString() });
  }
  async list(): Promise<VideoSkill[]> {
    const ids = new Set<string>();
    for (const root of [this.options.builtinRoot, await this.userRoot()]) {
      let entries; try { entries = await readdir(root, { withFileTypes: true }); } catch (error) { if (isMissing(error)) continue; throw error; }
      for (const entry of entries) if (skillIdSchema.safeParse(entry.name).success) {
        if (entry.isSymbolicLink()) throw new IpcFailure({ code: 'forbidden', message: 'Skill folders cannot be symbolic links.' });
        if (entry.isDirectory()) ids.add(entry.name);
      }
    }
    const result: VideoSkill[] = [];
    for (const id of [...ids].sort()) result.push(videoSkillSchema.parse(this.summary(await this.get(id))));
    return result;
  }
  private summary({ instructions: _instructions, ...skill }: VideoSkillDetail): VideoSkill { void _instructions; return skill; }
  private serialize<T>(action: () => Promise<T>): Promise<T> { const result = this.pending.then(action); this.pending = result.catch(() => undefined); return result; }
  save(input: InvokeReq<'skills.save'>, compositionInputs: string[] = []): Promise<VideoSkillDetail> {
    return this.serialize(async () => {
      const request = contract.invoke['skills.save'].req.parse(input);
      const compositions = compositionInputs.map((name) => compositionNameSchema.parse(name));
      if (compositions.length > 100 || new Set(compositions).size !== compositions.length) throw new IpcFailure({ code: 'invalid_request', message: 'Choose up to 100 different compositions.' });
      const userRoot = await this.userRoot();
      let id = request.id ?? (request.name.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '').slice(0, 56) || `skill-${randomUUID().slice(0, 8)}`);
      if (await this.isBuiltin(id)) throw new IpcFailure({ code: 'forbidden', message: 'Built-in video types cannot be changed or replaced.' });
      if (!request.id) {
        const base = id;
        for (let index = 2; await this.exists(userRoot, id); index++) { id = `${base.slice(0, 56)}-${index}`; if (await this.isBuiltin(id)) throw new IpcFailure({ code: 'forbidden', message: 'This id belongs to a built-in video type.' }); }
      }
      skillIdSchema.parse(id);
      const markdown = `---\n${stringify({ name: request.name, description: request.description })}---\n${request.instructions}\n`;
      if (await this.exists(userRoot, id)) {
        if (compositions.length) throw new IpcFailure({ code: 'conflict', message: 'Save composition templates as a new video type.' });
        await atomicWrite(await managedPath(userRoot, id), 'SKILL.md', markdown);
      } else {
        const staging = await mkdtemp(path.join(userRoot, '.skill-'));
        try {
          await atomicWrite(staging, 'SKILL.md', markdown);
          let remaining = MAX_BYTES;
          if (compositions.length) {
            const project = this.options.current(); await mkdir(path.join(staging, 'compositions'), { mode: 0o700 });
            for (const name of compositions) {
              const source = await managedPath(project.rootPath, `compositions/${name}`);
              const target = await managedPath(staging, `compositions/${name}`); await mkdir(target, { mode: 0o700 });
              remaining -= await copyTree(source, target, remaining);
              try { const html = await readManaged(target, 'index.html'); await atomicWrite(target, 'index.html', html.replaceAll(this.options.baseUrl, '__CUTROOM_COMP_BASE__')); }
              catch (error) { if (!isMissing(error)) throw error; }
            }
          }
          const target = await managedPath(userRoot, id);
          if (await this.exists(userRoot, id)) throw new IpcFailure({ code: 'conflict', message: 'This video type already exists.' });
          await rename(staging, target);
        } finally { await rm(staging, { recursive: true, force: true }); }
      }
      const saved = await this.get(id); this.options.changed(await this.list()); return saved;
    });
  }
  delete(input: string): Promise<{ ok: true }> {
    return this.serialize(async () => {
      const id = skillIdSchema.parse(input);
      if (await this.isBuiltin(id)) throw new IpcFailure({ code: 'forbidden', message: 'Built-in video types cannot be deleted.' });
      const root = await this.root(id); await this.get(id);
      await rm(root, { recursive: true }); this.options.changed(await this.list()); return { ok: true };
    });
  }
}
