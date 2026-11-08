import { mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod/v3';
import { IpcFailure } from '@shared/ipc/errors';
import { compositionNameSchema, type CompositionInfo, type CompositionCheck } from '@shared/schema/compositions';
import { propsDocSchema } from '@shared/schema/props';
import { skillIdSchema } from '@shared/schema/skills';
import type { ProjectSession } from '@shared/schema/project';
import { atomicWrite, copyTree, managedPath, readManaged } from '../fs/managed';

const manifestSchema = z.object({ id: compositionNameSchema, name: z.string().min(1), engine: z.enum(['hyperframes', 'remotion']), description: z.string(), durationSec: z.number().positive().default(5), entry: z.enum(['index.html', 'index.tsx']).default('index.html'), compositionId: z.string().optional() }).passthrough();
export class CompositionsService {
  constructor(private readonly options: { root: string; current: () => ProjectSession; baseUrl: string; skillRoot?: (id: string) => Promise<string> }) {}
  private async manifests() {
    const entries = await readdir(path.join(this.options.root, 'builtin'), { withFileTypes: true }); const result: { folder: string; manifest: z.infer<typeof manifestSchema> }[] = [];
    for (const entry of entries) if (entry.isDirectory() && compositionNameSchema.safeParse(entry.name).success) {
      try { result.push({ folder: entry.name, manifest: manifestSchema.parse(JSON.parse(await readManaged(this.options.root, `builtin/${entry.name}/manifest.json`))) }); } catch { /* Only complete, valid shipped templates are offered. */ }
    }
    return result;
  }
  async templates() { return (await this.manifests()).map(({ manifest }) => ({ id: manifest.id, name: manifest.name, engine: manifest.engine, description: manifest.description })); }
  async list(): Promise<CompositionInfo[]> {
    const session = this.options.current(); const root = await managedPath(session.rootPath, 'compositions'); const entries = await readdir(root, { withFileTypes: true }); const result: CompositionInfo[] = [];
    for (const entry of entries) if (entry.isDirectory() && compositionNameSchema.safeParse(entry.name).success) {
      try { propsDocSchema.parse(JSON.parse(await readManaged(root, `${entry.name}/props.json`))); const manifest = manifestSchema.parse(JSON.parse(await readManaged(root, `${entry.name}/manifest.json`))); result.push({ name: entry.name, engine: manifest.engine, path: `compositions/${entry.name}`, durationSec: manifest.durationSec, ...(manifest.compositionId ? { compositionId: manifest.compositionId } : {}) }); } catch { /* Incomplete agent-created compositions are checked explicitly, not offered as runnable. */ }
    }
    return result;
  }
  async create(templateId: string, inputName: string): Promise<CompositionInfo> {
    const name = compositionNameSchema.parse(inputName); const template = (await this.manifests()).find((entry) => entry.manifest.id === templateId); if (!template) throw new IpcFailure({ code: 'not_found', message: 'Composition template not found.' });
    return this.copy(await managedPath(this.options.root, `builtin/${template.folder}`), name, template.manifest);
  }
  async createFromSkill(skillId: string, compositionName: string, inputName: string): Promise<CompositionInfo> {
    const name = compositionNameSchema.parse(inputName); const templateName = compositionNameSchema.parse(compositionName);
    if (!this.options.skillRoot) throw new IpcFailure({ code: 'unavailable', message: 'The skills library is unavailable.' });
    const source = await managedPath(await this.options.skillRoot(skillIdSchema.parse(skillId)), `compositions/${templateName}`);
    const manifest = manifestSchema.parse(JSON.parse(await readManaged(source, 'manifest.json')));
    return this.copy(source, name, manifest);
  }
  private async copy(source: string, name: string, manifest: z.infer<typeof manifestSchema>): Promise<CompositionInfo> {
    const session = this.options.current(); const destination = await managedPath(session.rootPath, 'compositions'); let unique = name; let folder = '';
    for (let index = 1; ; index++) { unique = index === 1 ? name : `${name.slice(0, 90)}-${index}`; folder = await managedPath(destination, unique); try { await mkdir(folder, { mode: 0o700 }); break; } catch (error) { if (error instanceof Error && 'code' in error && error.code === 'EEXIST') continue; throw error; } }
    try {
      await copyTree(source, folder);
      if (manifest.entry === 'index.html') { const html = await readManaged(folder, 'index.html'); await atomicWrite(folder, 'index.html', html.replaceAll('__CUTROOM_COMP_BASE__', this.options.baseUrl)); }
      return { name: unique, engine: manifest.engine, path: `compositions/${unique}`, durationSec: manifest.durationSec, ...(manifest.compositionId ? { compositionId: manifest.compositionId } : {}) };
    } catch (error) { await rm(folder, { recursive: true, force: true }); throw error; }
  }
  async check(inputName: string): Promise<CompositionCheck> {
    const name = compositionNameSchema.parse(inputName); const root = await managedPath(this.options.current().rootPath, `compositions/${name}`); const violations: CompositionCheck['violations'] = [];
    try {
      const props = propsDocSchema.parse(JSON.parse(await readManaged(root, 'props.json')));
      const manifest = await readManaged(root, 'manifest.json').then((text) => manifestSchema.parse(JSON.parse(text))).catch(() => null);
      let html = '';
      if (manifest?.engine === 'remotion') {
        if (manifest.entry !== 'index.tsx') violations.push({ code: 'remotion_entry', message: 'Remotion templates require an index.tsx entry.' });
        const files = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name));
        if (files.length > 100) throw new Error('Too many source files');
        for (const entry of files) html += await readManaged(root, entry.name);
        if (!/registerRoot\s*\(/.test(html) || !/\bComposition\b/.test(html)) violations.push({ code: 'remotion_registration', message: 'Register a Remotion root containing a Composition.' });
      } else html = await readManaged(root, 'index.html');
      const ids = new Set([...html.matchAll(/\bdata-cut-id\s*=\s*["']([^"']+)["']/g)].map((match) => match[1]));
      for (const element of props.elements) if (!ids.has(element.id)) violations.push({ code: 'missing_cut_id', message: `Editable element ${element.id} has no matching data-cut-id.`, rel: `compositions/${name}/props.json` });
      if (manifest?.engine === 'remotion') return { ok: violations.length === 0, violations };
      for (const match of html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
        const resource = match[1]!;
        if (/^(?:https?:)?\/\//i.test(resource) && !resource.startsWith(`${this.options.baseUrl}runtime/`)) violations.push({ code: 'external_runtime', message: 'Use bundled local scripts and styles, not external CDNs.' });
      }
      if (!/\bdata-composition-id\s*=/.test(html)) violations.push({ code: 'composition_root', message: 'Add data-composition-id to the composition root.' });
      const clips = [...html.matchAll(/<[^>]*\bclass\s*=\s*["'][^"']*\bclip\b[^"']*["'][^>]*>/g)];
      if (!clips.length) violations.push({ code: 'missing_clip', message: 'Add at least one .clip element with timing and track attributes.' });
      for (const [index, clip] of clips.entries()) if (!['data-start', 'data-duration', 'data-track-index'].every((attribute) => new RegExp(`\\b${attribute}\\s*=`).test(clip[0]))) violations.push({ code: 'clip_timing', message: `Clip ${index + 1} is missing data-start, data-duration or data-track-index.` });
      if (!/window\.__timelines/.test(html)) violations.push({ code: 'timeline_registration', message: 'Register the GSAP timeline on window.__timelines.' });
    } catch { violations.push({ code: 'invalid_files', message: 'The composition needs readable index.html and valid props.json files.' }); }
    return { ok: violations.length === 0, violations };
  }
}
