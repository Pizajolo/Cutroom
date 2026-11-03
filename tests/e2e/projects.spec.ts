import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

let app: ElectronApplication | undefined;
let temporary: string;
let root: string;

// Generate a single tiny frame, not a binary checked into the repository.
// Override with a verified tool path on machines that don't have FFmpeg on PATH.
test.beforeEach(async () => {
  temporary = await mkdtemp(path.join(process.env.TMPDIR ?? tmpdir(), 'cutroom-project-e2e-'));
  root = path.join(temporary, 'footage');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(root);
  execFileSync(process.env.CUTROOM_TEST_FFMPEG ?? 'ffmpeg', [
    '-hide_banner', '-nostdin', '-n', '-f', 'lavfi', '-i', 'color=c=red:s=320x180',
    '-frames:v', '1', path.join(root, 'red.png'),
  ], { stdio: 'pipe' });
  const env = { ...process.env, CUTROOM_HOME: path.join(temporary, 'home') };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    args: [path.resolve('out/main/index.js'), `--user-data-dir=${path.join(temporary, 'electron')}`], env,
  });
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  }, root);
});

test.afterEach(async () => {
  try { await app?.close(); }
  finally { app = undefined; if (temporary) await rm(temporary, { recursive: true, force: true }); }
});

test('canceling plain-folder creation leaves the folder and project state unchanged', async () => {
  const page = await app!.firstWindow();
  const original = await readFile(path.join(root, 'red.png'));
  await page.getByRole('button', { name: 'Browse media folder', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create a project in this folder?' });
  await expect(dialog).toContainText('Found 1 media files in the folder root.');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await readdir(root)).toEqual(['red.png']);
  expect(await readFile(path.join(root, 'red.png'))).toEqual(original);
  expect(await page.evaluate(() => window.cutroom.invoke('project.current', {}))).toEqual({ ok: true, data: null });
  expect(await page.evaluate(() => window.cutroom.invoke('project.listRecent', {}))).toEqual({ ok: true, data: [] });
});

test('Folder media creates one recent project, copies loose media without moving it, and adds an undoable still', async () => {
  const page = await app!.firstWindow();
  const original = await readFile(path.join(root, 'red.png'));
  await page.getByRole('button', { name: 'Browse media folder', exact: true }).click();
  await page.getByRole('button', { name: 'Create project here', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add text', exact: true })).toBeEnabled();
  const before = await page.evaluate(() => window.cutroom.invoke('project.current', {}));
  expect(before.ok && before.data?.rootPath).toBe(root);
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await expect(page.locator('.recent-list > li')).toHaveCount(1);
  await expect(page.locator('.recent-list')).toContainText(root);
  await page.getByRole('button', { name: 'Folder media', exact: true }).click();
  const loose = page.getByRole('region', { name: 'Folder root', exact: true });
  await expect(loose.getByRole('button', { name: 'Preview red.png', exact: true })).toBeVisible();
  await loose.getByRole('button', { name: 'Copy into Footage', exact: true }).click();
  await expect(page.getByText('Copied to Footage. Original kept.', { exact: true })).toBeVisible();
  expect(await readFile(path.join(root, 'red.png'))).toEqual(original);
  expect(await readFile(path.join(root, 'raw/red.png'))).toEqual(original);
  await loose.getByRole('button', { name: 'Add to timeline', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Editor', exact: true })).toHaveAttribute('aria-selected', 'true');
  const added = await page.evaluate(() => window.cutroom.invoke('timeline.get', {}));
  expect(added.ok).toBe(true);
  if (!added.ok) throw new Error(added.error.message);
  expect(added.data.doc.tracks.flatMap((track) => track.items)).toEqual([
    expect.objectContaining({ type: 'clip', src: 'red.png', start: 0, duration: 5, in: 0, out: 5 }),
  ]);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => {
    const state = await page.evaluate(() => window.cutroom.invoke('timeline.get', {}));
    return state.ok ? state.data.doc.tracks.flatMap((track) => track.items).length : -1;
  }).toBe(0);
  const after = await page.evaluate(() => window.cutroom.invoke('project.current', {}));
  expect(after).toEqual(before);
  const recents = await page.evaluate(() => window.cutroom.invoke('project.listRecent', {}));
  expect(recents.ok && recents.data.length).toBe(1);
});
