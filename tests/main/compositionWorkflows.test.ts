import { afterEach, expect, it } from 'vitest';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CompositionsService } from '@main/compositions/service';
import { resolveCompositionPath, startCompositionServer } from '@main/server/compositionServer';
import { applyProps } from '@shared/props/applyProps';
import { propsDocSchema } from '@shared/schema/props';
import { JSDOM } from 'jsdom';
import type { ProjectSession } from '@shared/schema/project';

const roots: string[] = [];
async function temporary() { const root = await mkdtemp(path.join(process.env.TMPDIR ?? tmpdir(), 'cutroom-compositions-')); roots.push(root); return root; }
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const props = { version: 1, elements: [{ id: 'title', name: 'Title', kind: 'text', props: { text: { type: 'text', bind: 'text', default: 'Hello' } } }] };
const html = '<main data-composition-id="title"><h1 class="clip" data-cut-id="title" data-start="0" data-duration="5" data-track-index="1">Hello</h1></main><script>window.__timelines={}</script>';
async function setup() {
  const root = await temporary(); const templates = path.join(root, 'templates'); const project = path.join(root, 'project'); await mkdir(path.join(templates, 'builtin/title'), { recursive: true }); await mkdir(path.join(project, 'compositions'), { recursive: true });
  await writeFile(path.join(templates, 'builtin/title/manifest.json'), JSON.stringify({ id: 'title', name: 'Title', engine: 'hyperframes', description: 'Test', entry: 'index.html', durationSec: 5 })); await writeFile(path.join(templates, 'builtin/title/props.json'), JSON.stringify(props)); await writeFile(path.join(templates, 'builtin/title/index.html'), html);
  const service = new CompositionsService({ root: templates, baseUrl: 'http://127.0.0.1:1234/k/token/', current: () => ({ rootPath: project } as ProjectSession) }); return { root, templates, project, service };
}
it('creates unique compositions and checks props IDs, local runtimes and malformed markup', async () => {
  const env = await setup(); expect((await env.service.templates()).map((item) => item.id)).toEqual(['title']); expect((await env.service.create('title', 'my-title')).name).toBe('my-title'); expect((await env.service.create('title', 'my-title')).name).toBe('my-title-2'); expect((await env.service.check('my-title')).ok).toBe(true);
  const entry = path.join(env.project, 'compositions/my-title/index.html'); await writeFile(entry, html.replace('data-cut-id="title"', 'data-cut-id="wrong"') + '<script src="https://cdn.example.com/runtime.js"></script>'); const check = await env.service.check('my-title'); expect(check.ok).toBe(false); expect(check.violations.map((issue) => issue.code)).toEqual(expect.arrayContaining(['missing_cut_id', 'external_runtime'])); expect(await env.service.list()).toHaveLength(2);
});
it('resolves literal composition files only, revokes projects, and rejects traversal and symlink escapes', async () => {
  const env = await setup(); await env.service.create('title', 'my-title'); await mkdir(path.join(env.project, 'raw')); await writeFile(path.join(env.project, 'raw/source.mp4'), 'source'); await symlink('../../raw', path.join(env.project, 'compositions/my-title/escape')); let active = true;
  const options = { projectRoot: (id: string) => active && id === 'project' ? env.project : undefined, compositionsRoot: env.templates, mediaBaseUrl: 'http://127.0.0.1:4567/k/media/' };
  const file = await resolveCompositionPath(options, 'p/project/compositions/my-title/index.html'); expect(await readFile(file, 'utf8')).toBe(html);
  for (const rel of ['p/project/compositions/my-title/../index.html', 'p/project/compositions/my-title/%2e%2e/index.html', 'p/project/compositions/my-title/escape/source.mp4', 'p/project/raw/source.mp4']) await expect(resolveCompositionPath(options, rel)).rejects.toThrow(); active = false; await expect(resolveCompositionPath(options, 'p/project/compositions/my-title/index.html')).rejects.toThrow();
});
it('sets attribute and safe image bindings and rejects traversal or an unknown binding before writes', () => {
  const dom = new JSDOM('<img data-cut-id="image">'); const schema = propsDocSchema.parse({ version: 1, elements: [{ id: 'image', name: 'Image', kind: 'image', props: { image: { type: 'image', bind: 'src', default: 'images/safe.png' }, caption: { type: 'text', bind: 'attr:data-prop-caption', default: 'Caption' } } }] });
  try { applyProps(dom.window.document, schema, {}); expect(dom.window.document.querySelector('img')!.getAttribute('src')).toBe('images/safe.png'); expect(dom.window.document.querySelector('img')!.getAttribute('data-prop-caption')).toBe('Caption'); expect(() => applyProps(dom.window.document, schema, { image: { image: '../raw/source.mp4' } })).toThrow(); expect(() => propsDocSchema.parse({ ...schema, elements: [{ ...schema.elements[0], props: { bad: { type: 'text', bind: 'innerHTML', default: 'x' } } }] })).toThrow(); } finally { dom.window.close(); }
});
it('serves only tokenized local composition assets with a sandbox CSP', async (context) => {
  const env = await setup(); await env.service.create('title', 'my-title'); let server: Awaited<ReturnType<typeof startCompositionServer>>;
  try { server = await startCompositionServer({ projectRoot: () => env.project, compositionsRoot: env.templates, mediaBaseUrl: 'http://127.0.0.1:4567/' }); } catch (error) { if (error instanceof Error && 'code' in error && error.code === 'EPERM') { context.skip('Sandbox denies local binding (EPERM); enable sandbox.network.allowLocalBinding to run HTTP assertions.'); return; } throw error; }
  try { const address = new URL(server.baseUrl); expect((await fetch(`${address.origin}/no-token`)).status).toBe(403); const result = await fetch(`${server.baseUrl}p/project/compositions/my-title/index.html`); expect(result.status).toBe(200); expect(result.headers.get('content-security-policy')).toContain('sandbox allow-scripts'); expect((await fetch(`${server.baseUrl}runtime/gsap.min.js`)).status).toBe(200); } finally { await server.close(); }
});
it('checks the actual builtins when an integration composition directory is supplied', async (context) => {
  const source = process.env.CUTROOM_TEST_COMPOSITIONS;
  if (!source) { context.skip('Set CUTROOM_TEST_COMPOSITIONS to merged src/compositions to validate actual frontend templates.'); return; }
  const env = await setup(); await cp(source, env.templates, { recursive: true }); const templates = await env.service.templates(); expect(templates.map((entry) => entry.id)).toEqual(expect.arrayContaining(['text-layer', 'captions', 'remotion-title']));
  for (const template of templates) { const created = await env.service.create(template.id, `check-${template.id}`); const result = await env.service.check(created.name); expect(result, JSON.stringify({ template: template.id, result })).toEqual({ ok: true, violations: [] }); }
});
