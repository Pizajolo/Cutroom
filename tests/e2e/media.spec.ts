import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Real, tiny PCM fixtures; no bundled tools or network needed to create them.
function wave(frequency: number): Buffer {
  const rate = 8000;
  const samples = rate / 4;
  const bytes = samples * 2;
  const buffer = Buffer.alloc(44 + bytes);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + bytes, 4);
  buffer.write('WAVEfmt ', 8); buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(bytes, 40);
  for (let i = 0; i < samples; i++) buffer.writeInt16LE(Math.round(3000 * Math.sin(2 * Math.PI * frequency * i / rate)), 44 + i * 2);
  return buffer;
}

let app: ElectronApplication;
let temporary: string;
let root: string;
const names = ['100% done.wav', 'take%20one.wav', 'take one.wav', '%2e%2e.wav', '%00.wav'];

test.beforeEach(async () => {
  temporary = await mkdtemp(path.join(tmpdir(), 'cutroom-electron-media-'));
  root = path.join(temporary, 'project');
  await mkdir(path.join(root, 'raw'), { recursive: true });
  for (const [index, name] of names.entries()) await writeFile(path.join(root, 'raw', name), wave(300 + index * 100));
  const env: NodeJS.ProcessEnv = { ...process.env, CUTROOM_HOME: path.join(temporary, 'home') };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: [path.resolve('out/main/index.js'), `--user-data-dir=${path.join(temporary, 'electron')}`], env });
  // Only replace the OS file chooser; keep preload, IPC, service and HTTP real.
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  }, root);
  const page = await app.firstWindow();
  // Rail -> Projects -> Open project; a plain media folder requires explicit in-place project creation.
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'Open project', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Create a project in this folder?' })).toBeVisible();
  await page.getByRole('button', { name: 'Create project here', exact: true }).click();
  // The media browser is the default tab of the project panel; there is no separate Folder media tab.
  await expect(page.getByRole('textbox', { name: 'Search media' })).toBeVisible();
});

test.afterEach(async () => {
  try { if (app) await app.close(); }
  finally { if (temporary) await rm(temporary, { recursive: true, force: true }); }
});

test('literal percent filenames survive listing and exact HTTP byte ranges', async () => {
  const page = await app.firstWindow();
  const reply = await page.evaluate(() => window.cutroom.invoke('media.list', {}));
  expect(reply.ok).toBe(true);
  if (!reply.ok) throw new Error(reply.error.message);
  expect(reply.data.map((file) => file.rel).sort()).toEqual(names.map((name) => `raw/${name}`).sort());
  for (const file of reply.data) {
    await expect(page.getByRole('button', { name: `Select ${file.name}`, exact: true })).toBeVisible();
    const expected = await readFile(path.join(root, file.rel));
    const response = await page.request.get(file.url);
    expect(response.status()).toBe(200);
    expect(await response.body()).toEqual(expected);
    const range = await page.request.get(file.url, { headers: { Range: 'bytes=0-43' } });
    expect(range.status()).toBe(206);
    expect(await range.body()).toEqual(expected.subarray(0, 44));
  }
  expect(await readFile(path.join(root, 'raw/take%20one.wav'))).not.toEqual(await readFile(path.join(root, 'raw/take one.wav')));
});

test('source preview loads PCM through the authenticated media origin', async () => {
  const page = await app.firstWindow();
  await page.getByRole('button', { name: 'Select 100% done.wav', exact: true }).click();
  await page.getByRole('button', { name: 'Inspect', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Source: 100% done.wav', exact: true })).toBeVisible();
  await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => Number.isFinite(audio.duration) ? audio.duration : null)).toBeCloseTo(0.25, 2);
  expect(await page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.error?.message ?? null)).toBeNull();
  expect(await page.evaluate(() => ({ require: typeof Reflect.get(window, 'require'), process: typeof Reflect.get(window, 'process') }))).toEqual({ require: 'undefined', process: 'undefined' });
});

test('native import preserves source bytes and allocates a unique duplicate name', async () => {
  const page = await app.firstWindow();
  const source = path.join(temporary, 'take one.wav');
  const bytes = wave(900);
  await writeFile(source, bytes);
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, source);
  const imported = await page.evaluate(() => window.cutroom.invoke('media.importDialog', { destination: 'raw' }));
  expect(imported.ok).toBe(true);
  if (!imported.ok) throw new Error(imported.error.message);
  expect(imported.data.map((file) => file.rel)).toEqual(['raw/take one-1.wav']);
  expect(await readFile(source)).toEqual(bytes);
  expect(await readFile(path.join(root, 'raw/take one-1.wav'))).toEqual(bytes);
  expect(await readFile(path.join(root, 'raw/take one.wav'))).toEqual(wave(500));
  const forbidden = await page.evaluate((file) => window.cutroom.invoke('media.importPaths', { paths: [file], destination: 'raw' }), source);
  expect(forbidden).toMatchObject({ ok: false, error: { code: 'forbidden' } });
});
