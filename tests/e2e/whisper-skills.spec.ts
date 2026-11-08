import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Real main process and IPC with an empty CUTROOM_HOME: nothing is stubbed except the OS file chooser.
let app: ElectronApplication;
let temporary: string;

test.beforeEach(async () => {
  temporary = await mkdtemp(path.join(process.env.TMPDIR ?? tmpdir(), 'cutroom-whisper-skills-'));
  const env: NodeJS.ProcessEnv = { ...process.env, CUTROOM_HOME: path.join(temporary, 'home') };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: [path.resolve('out/main/index.js'), `--user-data-dir=${path.join(temporary, 'electron')}`], env });
});

test.afterEach(async () => {
  try { await app?.close(); } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('whisper-cli reports a definite state at startup: building, ok, or an actionable prerequisite (never silent "missing")', async () => {
  const page = await app.firstWindow();
  const read = async () => {
    const reply = await page.evaluate(() => window.cutroom.invoke('tools.list', {}));
    if (!reply.ok) throw new Error(reply.error.message);
    return reply.data.find((tool) => tool.name === 'whisper-cli');
  };
  // Startup must either start the automatic build (install progress present), finish it (ok), or offer a concrete action/hint.
  await expect.poll(async () => {
    const whisper = await read();
    return !!whisper && (whisper.status === 'ok' || whisper.install !== null || !!whisper.action || !!whisper.hint);
  }, { timeout: 20_000 }).toBe(true);
});

test('built-in video skills are listed, readable, and user skills round-trip with path-safe ids', async () => {
  const page = await app.firstWindow();
  const list = await page.evaluate(() => window.cutroom.invoke('skills.list', {}));
  expect(list.ok).toBe(true);
  if (!list.ok) throw new Error(list.error.message);
  expect(list.data.filter((skill) => skill.source === 'builtin').length).toBeGreaterThan(0);
  const first = list.data[0]!;
  const detail = await page.evaluate((id) => window.cutroom.invoke('skills.get', { id }), first.id);
  expect(detail.ok && detail.data.instructions.length).toBeGreaterThan(0);
  const saved = await page.evaluate(() => window.cutroom.invoke('skills.save', { name: 'QA reel', description: 'qa', instructions: 'Open with a hook.' }));
  expect(saved.ok).toBe(true);
  if (!saved.ok) throw new Error(saved.error.message);
  const id = (saved.data as { id: string }).id;
  const removed = await page.evaluate((skillId) => window.cutroom.invoke('skills.delete', { id: skillId }), id);
  expect(removed.ok).toBe(true);
  // Path traversal through the id is rejected by the contract rather than reaching the filesystem.
  const evil = await page.evaluate(() => window.cutroom.invoke('skills.get', { id: '../../etc/passwd' }).catch((e: unknown) => ({ ok: false, thrown: String(e) })));
  expect(evil.ok).toBe(false);
});
