import { afterEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { copyFile, mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FolderGrants } from '@main/projects/grants';
import { ProjectService } from '@main/projects/service';
import { MediaService } from '@main/media/service';
import { TimelineService } from '@main/timeline/service';
import { resolveInProject } from '@main/fs/safePath';
import { atomicJson } from '@main/fs/managed';
import type { TimelineItem } from '@shared/schema/timeline';

const roots: string[] = []; const services: MediaService[] = [];
const format = { aspect: '16:9', width: 320, height: 180, fps: 30 } as const;
const creation = { name: 'Example', format, defaultEngine: 'hyperframes' } as const;
async function setup(projectOptions: Pick<ConstructorParameters<typeof ProjectService>[0], 'copyFootage' | 'now'> = {}) {
  const root = await mkdtemp(path.join(process.env.TMPDIR ?? tmpdir(), 'cutroom-project-test-')); roots.push(root);
  const home = path.join(root, 'home'); const footage = path.join(root, 'footage'); await mkdir(footage);
  const media = new MediaService({ resolveTool: async () => { throw new Error('No tools'); }, url: (_id, rel) => `http://127.0.0.1/${rel}` }); services.push(media);
  const project = new ProjectService({ home, media, ...projectOptions });
  return { root, home, footage, media, project };
}
async function initialized() { const env = await setup(); const grant = await env.project.grants.issue(env.footage, 'openProject'); const session = await env.project.createInPlace({ ...creation, grantId: grant.grantId }); return { ...env, session }; }
const clip: TimelineItem = { type: 'clip', id: 'clip_abcdefghij', src: 'raw/example.mp4', start: 0, duration: 3, in: 0, out: 3, speed: 1, volume: 1, muted: false, createdBy: 'system', userEdited: [] };
afterEach(async () => { services.splice(0).forEach((service) => service.close()); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe('persistent project capabilities', () => {
  it('consumes purpose-bound grants exactly once and expires them', async () => {
    const { footage } = await setup(); let now = 0; const grants = new FolderGrants(() => now);
    const first = await grants.issue(footage, 'openProject'); expect(() => grants.consume(first.grantId, 'footage')).toThrow(); expect(() => grants.consume(first.grantId, 'openProject')).toThrow();
    const second = await grants.issue(footage, 'openProject'); now = 10 * 60_000; expect(() => grants.consume(second.grantId, 'openProject')).toThrow();
  });
  it('opens a plain folder for confirmation, preserves originals, adopts with -2 collisions and persists recents', async () => {
    const env = await setup(); const bytes = Buffer.from('original footage'); await writeFile(path.join(env.footage, 'a.mp4'), bytes);
    const grant = await env.project.grants.issue(env.footage, 'openProject'); const opened = await env.project.open({ grantId: grant.grantId });
    expect(opened.status).toBe('needsCreate'); if (opened.status !== 'needsCreate') throw new Error('Expected creation confirmation');
    expect(opened.looseMediaCount).toBe(1); expect(await readFile(path.join(env.footage, 'a.mp4'))).toEqual(bytes);
    const session = await env.project.createInPlace({ ...creation, grantId: opened.grantId });
    await writeFile(path.join(env.footage, 'raw/a.mp4'), 'already imported');
    const adopted = await env.project.adoptLooseMedia(['a.mp4']); expect(adopted[0]?.rel).toBe('raw/a-2.mp4');
    expect(await readFile(path.join(env.footage, 'raw/a-2.mp4'))).toEqual(bytes); expect(await readFile(path.join(env.footage, 'a.mp4'))).toEqual(bytes);
    expect((await env.media.list()).some((file) => file.rel === 'a.mp4' && file.section === 'root')).toBe(true);
    expect((await new ProjectService({ home: env.home, media: env.media }).listRecent())[0]).toMatchObject({ id: session.project.id, missing: false });
    expect((await stat(path.join(env.home, 'recent-projects.json'))).mode & 0o777).toBe(0o600);
    await env.project.close(); await rm(path.join(env.footage, '.cutroom/project.json')); expect((await env.project.listRecent())[0]?.missing).toBe(true);
  });
  it('creates unique child projects and clone-copies footage without moving it', async () => {
    const env = await setup(); await writeFile(path.join(env.footage, 'a.mp4'), 'source');
    const parent = await env.project.grants.issue(env.root, 'projectParent'); const footage = await env.project.grants.issue(env.footage, 'footage');
    const first = await env.project.create({ ...creation, parentGrant: parent.grantId, footageGrant: footage.grantId });
    const second = await env.project.create({ ...creation, parentGrant: (await env.project.grants.issue(env.root, 'projectParent')).grantId });
    expect(path.basename(second.rootPath)).toBe('Example-2'); expect(await readFile(path.join(first.rootPath, 'raw/a.mp4'), 'utf8')).toBe('source'); expect(await readFile(path.join(env.footage, 'a.mp4'), 'utf8')).toBe('source');
    expect(JSON.parse(await readFile(path.join(first.rootPath, 'timeline.json'), 'utf8')).tracks).toHaveLength(8); expect(env.media.rootFor(first.project.id)).toBeUndefined(); expect(env.media.rootFor(second.project.id)).toBe(second.rootPath);
  });
  it('keeps a partially imported project reachable and retries only unpublished footage without a duplicate project', async () => {
    let fail = true;
    const copy = vi.fn<typeof copyFile>(async (source, destination, mode) => {
      if (path.basename(String(source)) === 'b.mp4' && fail) { await writeFile(destination, 'partial'); throw new Error('Disk full'); }
      return copyFile(source, destination, mode);
    });
    const env = await setup({ copyFootage: copy });
    await writeFile(path.join(env.footage, 'a.mp4'), 'source a'); await writeFile(path.join(env.footage, 'b.mp4'), 'source b');
    const parent = await env.project.grants.issue(env.root, 'projectParent'); const footage = await env.project.grants.issue(env.footage, 'footage');
    const result = await env.project.create({ ...creation, parentGrant: parent.grantId, footageGrant: footage.grantId });
    expect(result.importWarning).toMatchObject({ completed: 1, total: 2 }); expect(env.project.current()?.project.id).toBe(result.project.id);
    expect((await env.project.listRecent()).map((entry) => entry.id)).toEqual([result.project.id]);
    expect(await readdir(path.join(result.rootPath, 'raw'))).toEqual(['a.mp4']); expect(await readdir(path.join(result.rootPath, 'work'))).toEqual([]);
    const retry = result.importWarning!.retryId;
    const again = await env.project.retryFootageImport(retry); expect(again.importWarning).toMatchObject({ completed: 1, total: 2 }); expect(again.importWarning!.retryId).not.toBe(retry);
    await expect(env.project.retryFootageImport(retry)).rejects.toMatchObject({ code: 'forbidden' });
    await env.project.close(); expect(await env.project.open({ recentId: result.project.id })).toMatchObject({ status: 'opened', session: { project: { id: result.project.id } } });
    fail = false; const recovered = await env.project.retryFootageImport(again.importWarning!.retryId);
    expect(recovered.importWarning).toBeUndefined(); expect(recovered.rootPath).toBe(result.rootPath); expect(recovered.project.id).toBe(result.project.id);
    expect(await readdir(path.join(result.rootPath, 'raw'))).toEqual(['a.mp4', 'b.mp4']); expect(await readdir(path.join(result.rootPath, 'work'))).toEqual([]);
    expect(copy.mock.calls.filter(([source]) => path.basename(String(source)) === 'a.mp4')).toHaveLength(1);
    expect(await readFile(path.join(result.rootPath, 'raw/a.mp4'), 'utf8')).toBe('source a'); expect(await readFile(path.join(result.rootPath, 'raw/b.mp4'), 'utf8')).toBe('source b');
    expect(await readFile(path.join(env.footage, 'a.mp4'), 'utf8')).toBe('source a'); expect(await readFile(path.join(env.footage, 'b.mp4'), 'utf8')).toBe('source b');
    expect((await readdir(env.root)).filter((name) => name.startsWith('Example'))).toEqual(['Example']);
    await expect(env.project.retryFootageImport(again.importWarning!.retryId)).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('binds import retry authority to the original project and expires it', async () => {
    let now = 0; const env = await setup({ now: () => now, copyFootage: async () => { throw new Error('Copy unavailable'); } });
    await writeFile(path.join(env.footage, 'a.mp4'), 'source');
    const result = await env.project.create({ ...creation, parentGrant: (await env.project.grants.issue(env.root, 'projectParent')).grantId, footageGrant: (await env.project.grants.issue(env.footage, 'footage')).grantId });
    const next = await env.project.create({ ...creation, parentGrant: (await env.project.grants.issue(env.root, 'projectParent')).grantId });
    await expect(env.project.retryFootageImport(result.importWarning!.retryId)).rejects.toMatchObject({ code: 'conflict' });
    expect(await readdir(path.join(next.rootPath, 'raw'))).toEqual([]);
    await env.project.open({ recentId: result.project.id }); now = 10 * 60_000;
    await expect(env.project.retryFootageImport(result.importWarning!.retryId)).rejects.toMatchObject({ code: 'forbidden' });
    expect(await readdir(path.join(result.rootPath, 'raw'))).toEqual([]);
    expect((await env.project.listRecent()).some((entry) => entry.id === result.project.id)).toBe(true);
  });
  it('protects loose root files and symlink aliases from agent writes', async () => {
    const { footage } = await setup(); await writeFile(path.join(footage, 'source.mp4'), 'keep'); await mkdir(path.join(footage, 'work')); await symlink('../source.mp4', path.join(footage, 'work/alias.mp4'));
    await expect(resolveInProject(footage, 'source.mp4', { write: true })).rejects.toThrow(); await expect(resolveInProject(footage, 'work/alias.mp4', { write: true })).rejects.toThrow();
    expect(await readFile(path.join(footage, 'source.mp4'), 'utf8')).toBe('keep');
  });
});

describe('durable timeline single writer', () => {
  it('serializes edits, refuses stale revisions before mutation and journals once per edit', async () => {
    const { session } = await initialized(); const service = await TimelineService.load(session.rootPath);
    await service.apply([{ type: 'addItem', trackId: 'video', item: clip }], { actor: 'system', label: 'Import' });
    const before = await readFile(path.join(session.rootPath, 'timeline.json'));
    await expect(service.apply([{ type: 'setProps', itemId: clip.id, patch: { volume: 0.3 } }], { actor: 'user', label: 'Stale', baseRevision: 0 })).rejects.toMatchObject({ code: 'conflict' });
    expect(await readFile(path.join(session.rootPath, 'timeline.json'))).toEqual(before);
    await Promise.all([service.apply([{ type: 'setProps', itemId: clip.id, patch: { volume: 0.4 } }], { actor: 'user', label: 'Volume' }), service.apply([{ type: 'setProps', itemId: clip.id, patch: { note: 'note' } }], { actor: 'user', label: 'Note' })]);
    await expect(service.apply([{ type: 'setProps', itemId: clip.id, patch: { volume: 0.9 } }], { actor: 'agent:session', label: 'Overwrite' })).rejects.toMatchObject({ code: 'user_edited' });
    for (const rel of ['history', 'events']) expect((await readFile(path.join(session.rootPath, `.cutroom/${rel}.jsonl`), 'utf8')).trim().split('\n')).toHaveLength(3);
    expect((await TimelineService.load(session.rootPath)).state()).toEqual(service.state());
  });
  it('redo preserves split ids, snapshots restore as one undoable entry', async () => {
    const { session } = await initialized(); const service = await TimelineService.load(session.rootPath);
    await service.apply([{ type: 'addItem', trackId: 'video', item: clip }], { actor: 'system', label: 'Import' }); const original = service.state().doc;
    const snapshot = await service.createSnapshot('Before split');
    await service.apply([{ type: 'splitItem', itemId: clip.id, at: 1 }], { actor: 'user', label: 'Split' }); const split = service.state().doc;
    await service.undo(); expect(service.state().doc).toEqual(original); await service.redo(); expect(service.state().doc).toEqual(split);
    const revision = service.state().revision; await service.restoreSnapshot(snapshot.id); expect(service.state().doc).toEqual(original); expect(service.state().revision).toBe(revision + 1); await service.undo(); expect(service.state().doc).toEqual(split);
  });
  it('round-trips randomized user edit sequences through undo and redo including authority flags', async () => {
    await fc.assert(fc.asyncProperty(fc.array(fc.integer({ min: 0, max: 200 }), { minLength: 1, maxLength: 8 }), async (values) => {
      const { session } = await initialized(); const service = await TimelineService.load(session.rootPath);
      await service.apply([{ type: 'addItem', trackId: 'video', item: clip }], { actor: 'system', label: 'Import' }); const original = service.state().doc;
      for (const volume of values) await service.apply([{ type: 'setProps', itemId: clip.id, patch: { volume: volume / 100 } }], { actor: 'user', label: 'Volume' });
      const final = service.state().doc; for (let index = 0; index < values.length; index++) await service.undo(); expect(service.state().doc).toEqual(original); for (let index = 0; index < values.length; index++) await service.redo(); expect(service.state().doc).toEqual(final); await service.close();
    }), { numRuns: 10 });
  }, 30_000);
  it.each(['history', 'events', 'utf8'])('completes a crash-truncated %s journal by appending only the exact pending bytes', async (phase) => {
    const { session } = await initialized(); const service = await TimelineService.load(session.rootPath);
    await service.apply([{ type: 'addItem', trackId: 'video', item: clip }], { actor: 'system', label: 'Import' }); const before = service.state().doc;
    await service.apply([{ type: 'setProps', itemId: clip.id, patch: { volume: 0.5 } }], { actor: 'user', label: 'Speech 🐟' }); const expected = service.state();
    const historyFile = path.join(session.rootPath, '.cutroom/history.jsonl'); const eventFile = path.join(session.rootPath, '.cutroom/events.jsonl'); const history = await readFile(historyFile); const events = await readFile(eventFile);
    const entry = JSON.parse(history.toString('utf8').trim().split('\n').at(-1)!); await atomicJson(session.rootPath, '.cutroom/pending-timeline.json', { doc: expected.doc, entry });
    const historyStart = history.indexOf(10) + 1; const eventStart = events.indexOf(10) + 1;
    if (phase !== 'events') { const end = phase === 'utf8' ? history.indexOf(Buffer.from('🐟'), historyStart) + 2 : historyStart + 25; await writeFile(historyFile, history.subarray(0, end)); await writeFile(eventFile, events.subarray(0, eventStart)); await atomicJson(session.rootPath, 'timeline.json', before); }
    else await writeFile(eventFile, events.subarray(0, eventStart + 30));
    const recovered = await TimelineService.load(session.rootPath); expect(recovered.state()).toEqual(expected); expect(await readFile(historyFile)).toEqual(history); expect(await readFile(eventFile)).toEqual(events);
    expect((await TimelineService.load(session.rootPath)).state()).toEqual(expected); await service.close(); await recovered.close();
  });
  it('rejects a different pending edit at the same revision before changing any file', async () => {
    const { session } = await initialized(); const service = await TimelineService.load(session.rootPath); await service.apply([{ type: 'addItem', trackId: 'video', item: clip }], { actor: 'system', label: 'Import' });
    const historyFile = path.join(session.rootPath, '.cutroom/history.jsonl'); const eventFile = path.join(session.rootPath, '.cutroom/events.jsonl'); const history = await readFile(historyFile); const events = await readFile(eventFile); const timeline = await readFile(path.join(session.rootPath, 'timeline.json'));
    const entry = { ...JSON.parse(history.toString('utf8').trim()), id: 'different-edit' }; await atomicJson(session.rootPath, '.cutroom/pending-timeline.json', { doc: service.state().doc, entry });
    await expect(TimelineService.load(session.rootPath)).rejects.toMatchObject({ code: 'conflict' }); expect(await readFile(historyFile)).toEqual(history); expect(await readFile(eventFile)).toEqual(events); expect(await readFile(path.join(session.rootPath, 'timeline.json'))).toEqual(timeline);
  });
  it('recovers a committed recovery record without duplicating history or events', async () => {
    const { session } = await initialized(); const service = await TimelineService.load(session.rootPath);
    await service.apply([{ type: 'addItem', trackId: 'video', item: clip }], { actor: 'system', label: 'Import' });
    const entry = JSON.parse((await readFile(path.join(session.rootPath, '.cutroom/history.jsonl'), 'utf8')).trim());
    await atomicJson(session.rootPath, '.cutroom/pending-timeline.json', { doc: service.state().doc, entry });
    const recovered = await TimelineService.load(session.rootPath); expect(recovered.state()).toEqual(service.state());
    expect((await readFile(path.join(session.rootPath, '.cutroom/events.jsonl'), 'utf8')).trim().split('\n')).toHaveLength(1);
  });
});
