// Electron shell: one window, the project folder, a preview that follows the timeline, and IPC.
import { createReadStream, existsSync, watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { BrowserWindow, app, dialog, ipcMain, protocol, shell } from 'electron';
import { readTimeline, render } from '../cli/render';
import { run } from '../cli/run';
import { LIBRARY, toggleFavorite, addVersion, markFinal, readLedger, readVersions, styleVideos, unlinkVideo } from '../cli/project';
import { PROJECT_DIRS, cutFiles } from '../shared/types';
import type { ChatMessage, CutroomApi, Cuts, Mark, Project, Script, Timeline } from '../shared/types';
import * as agent from './agent';
import { dropCut, ensureCuts, listCuts, newCut, renameCut, setActive, splitCut } from './cuts';
import { downloadLinks, forgetProject, importFiles, listMedia, openProject, recentProjects } from './project';
import { claudeLogin, claudeStatus, cloneVoice, codexLogin, codexStatus, deleteVoice, features, loadSettings, micAccess, modelChoice, saveSettings, setProjectFeature, setProjectModel, voices } from './settings';
import { ensureTools, toolStatus } from './tools';

let win: BrowserWindow | undefined;
let project: Project | null = null;
/** The cut (chat + edit) on screen. */
let cut = '';
let timeline: Timeline | null = null;
let watcher: FSWatcher | undefined;
let previewJob: AbortController | undefined;
let previewVersion = 0;
let exporting = false;

const emit = (channel: string, payload: unknown): void => win?.webContents.send(channel, payload);
const root = (): string => {
  if (!project) throw new Error('Open a project first.');
  return project.root;
};

// --- Preview -----------------------------------------------------------------------------

/** Re-read the timeline, tell the UI, and render a fresh preview (cancelling a stale one). */
async function refresh(): Promise<void> {
  previewJob?.abort();
  const job = (previewJob = new AbortController());
  try {
    timeline = await readTimeline(root(), cut);
    emit('timeline', timeline);
    if (!timeline?.clips.length) return emit('preview', { rendering: false, version: 0 });
    emit('preview', { rendering: true, version: previewVersion });
    await render(root(), cut, { preview: true, signal: job.signal });
    previewVersion = Date.now();
    emit('preview', { rendering: false, version: previewVersion });
  } catch (error) {
    if (!job.signal.aborted) emit('preview', { rendering: false, version: previewVersion, error: (error as Error).message });
  }
}

/** The script awaits approval when it is newer than the edit (or there is no edit yet). */
async function readScript(dir: string): Promise<Script> {
  const files = cutFiles(cut);
  const file = path.join(dir, files.script);
  const text = await readFile(file, 'utf8').catch(() => '');
  const [written, edited] = await Promise.all([file, path.join(dir, files.timeline)].map((f) => stat(f).then((s) => s.mtimeMs, () => 0)));
  return { text, pending: !!text && written! > edited!, spokenCut: existsSync(path.join(dir, files.spokenCut)) };
}

/** Watch the project folder: timeline or overlay changes refresh the preview, media changes the file list. */
function watchProject(dir: string): void {
  watcher?.close();
  const changed = new Set<string>();
  let timer: NodeJS.Timeout | undefined;
  watcher = watch(dir, { recursive: true }, (_event, file) => {
    if (!file) return;
    changed.add(file);
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const files = [...changed];
      changed.clear();
      const own = cutFiles(cut);
      const used = new Set([own.timeline, ...(timeline ? [...timeline.overlays, ...timeline.audio].map((i) => i.src) : [])]);
      if (files.some((f) => used.has(f))) void refresh();
      if ([own.script, own.timeline, own.spokenCut].some((f) => files.includes(f))) emit('script', await readScript(dir));
      if (files.some((f) => PROJECT_DIRS.some((d) => f.startsWith(`${d}/`)))) emit('media', await listMedia(dir));
    }, 300);
  });
}

/** Put a cut on screen: its edit, preview and script. */
async function show(id: string): Promise<void> {
  previewJob?.abort();
  cut = id;
  timeline = null;
  // Start from this cut's own last preview (if any), never the previous one's.
  previewVersion = await stat(path.join(root(), cutFiles(cut).preview)).then((s) => Math.round(s.mtimeMs), () => 0);
  void refresh();
  emit('script', await readScript(root()));
}

async function open(dir: string): Promise<Project> {
  agent.stop();
  const next = await openProject(dir);
  await ensureCuts(dir);
  project = next;
  watchProject(dir);
  await show((await listCuts(dir)).active);
  return project;
}

/** Change which cut is on screen. Not while Claude works: its replies belong to the cut it was asked in. */
async function switchTo(cuts: Cuts): Promise<Cuts> {
  if (cuts.active !== cut) await show(cuts.active);
  return cuts;
}
const idle = (): void => {
  if (agent.running()) throw new Error('Wait until Claude has finished, or stop it.');
};

// --- IPC ---------------------------------------------------------------------------------

const chatFile = (): string => path.join(root(), cutFiles(cut).chat);

const api: Omit<CutroomApi, 'on' | 'pathForFile'> = {
  async openProject() {
    const picked = await dialog.showOpenDialog(win!, {
      title: 'Open a folder with your footage',
      properties: ['openDirectory', 'createDirectory'],
    });
    return picked.filePaths[0] ? open(picked.filePaths[0]) : null;
  },
  recentProjects,
  openRecent: (dir) => open(dir).catch(() => null),
  async importFiles(paths, dir) {
    const files = paths ?? (await dialog.showOpenDialog(win!, { properties: ['openFile', 'multiSelections'] })).filePaths;
    await importFiles(root(), files, dir);
  },
  downloadLinks: (urls, dir) => downloadLinks(root(), urls, dir),
  listMedia: () => listMedia(root()),
  getTimeline: async () => timeline,
  duration: async (file) =>
    Number(await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(root(), file)]).catch(() => 0)) || 0,
  saveTimeline: (next) => writeFile(path.join(root(), cutFiles(cut).timeline), JSON.stringify(next, null, 2)),
  cuts: () => listCuts(root()),
  switchCut: async (id) => (idle(), switchTo(await setActive(root(), id))),
  newCut: async (name) => (idle(), switchTo(await newCut(root(), name))),
  splitCut: async (message, name) => (idle(), switchTo(await splitCut(root(), cut, message, name))),
  renameCut: (id, name) => renameCut(root(), id, name),
  async deleteCut(id) {
    idle();
    const cuts = await dropCut(root(), id);
    await shell.trashItem(path.join(root(), cutFiles(id).dir)).catch(() => {});
    return switchTo(cuts);
  },
  loadChat: async () => JSON.parse(await readFile(chatFile(), 'utf8').catch(() => '[]')) as ChatMessage[],
  saveChat: (messages) => writeFile(chatFile(), JSON.stringify(messages)),
  send(text: string, marks: Mark[], files: string[], skills: string[]) {
    const [dir, at] = [root(), cut];
    return agent.send(dir, at, text, marks, files, skills, timeline, async (event) => {
      emit('agent', event);
      if (event.type !== 'done') return;
      // Keep the result of this step as a version, and catch anything the watcher missed (e.g. a graphic re-rendered in place).
      const after = await readTimeline(dir, at).catch(() => null);
      if (after?.clips.length) await addVersion(dir, at, text.split('\n')[0]!.slice(0, 80), after);
      if (project?.root === dir && cut === at) void refresh();
    });
  },
  async approveSpokenCut() {
    await rm(path.join(root(), cutFiles(cut).spokenCut), { force: true });
  },
  versions: () => readVersions(root(), cut),
  markFinal: (id) => markFinal(root(), cut, id),
  ledger: () => readLedger(root()),
  stop: async () => agent.stop(),
  async exportVideo() {
    if (exporting) throw new Error('An export is already running.');
    const dir = root();
    exporting = true;
    emit('export', 0);
    try {
      return path.relative(dir, await render(dir, cut, { onProgress: (done) => emit('export', done) }));
    } finally {
      exporting = false;
    }
  },
  reveal: async (file) => shell.showItemInFolder(path.join(root(), file)),
  async closeProject() {
    agent.stop();
    watcher?.close();
    previewJob?.abort();
    project = null;
  },
  forgetProject,
  listSkills: agent.listSkills,
  revealSkill: async (id) => shell.showItemInFolder(agent.skillFile(id)),
  async toggleFavorite(id) {
    await toggleFavorite(id);
    return agent.listSkills();
  },
  readSkill: (id) => readFile(agent.skillFile(id), 'utf8'),
  async saveSkill(id, text) {
    await writeFile(path.join(agent.customSkillDir(id), 'SKILL.md'), text);
    return agent.listSkills();
  },
  async removeExample(id, file) {
    const skills = await agent.listSkills();
    if (!skills.find((skill) => skill.id === id)?.examples.some((example) => example.file === file)) return skills;
    if (file.startsWith(LIBRARY + path.sep)) await shell.trashItem(file);
    else await unlinkVideo(id, file);
    return agent.listSkills();
  },
  async deleteSkill(id) {
    await shell.trashItem(agent.customSkillDir(id));
    return agent.listSkills();
  },
  getSettings: loadSettings,
  saveSettings,
  claudeStatus,
  claudeLogin,
  codexStatus,
  codexLogin,
  voices,
  micAccess,
  cloneVoice,
  deleteVoice,
  getScript: () => readScript(root()),
  features: () => features(project?.root),
  setProjectFeature: (id, on) => setProjectFeature(root(), id, on),
  getModel: () => modelChoice(root()),
  setProjectModel: (model) => setProjectModel(root(), model),
  tools: async () => toolStatus(),
};

// --- App ---------------------------------------------------------------------------------

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.m4v': 'video/mp4',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
};

protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
]);

/** `media://project/<path>` serves files from the open project, `media://style/<name>/example.mp4` from the style library
 * and `media://export/<absolute path>` a video listed under a style, with range requests so video can seek. */
async function serveMedia(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const base = url.host === 'style' ? path.join(LIBRARY, 'skills') : url.host === 'export' ? '/' : root();
  const file = path.join(base, decodeURIComponent(url.pathname));
  const allowed = url.host === 'export' ? Object.values(await styleVideos()).flat().includes(file) : file.startsWith(base + path.sep);
  if (!allowed) return new Response(null, { status: 403 });
  const size = await stat(file).then((s) => s.size, () => -1);
  if (size < 0) return new Response(null, { status: 404 });
  const range = /bytes=(\d*)-(\d*)/.exec(request.headers.get('range') ?? '');
  const start = Number(range?.[1] || 0);
  const end = Math.min(Number(range?.[2] || size - 1), size - 1);
  return new Response(Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream, {
    status: range ? 206 : 200,
    headers: {
      'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'content-length': String(end - start + 1),
      'content-range': `bytes ${start}-${end}/${size}`,
      'accept-ranges': 'bytes',
      'cache-control': 'no-store',
    },
  });
}

void app.whenReady().then(() => {
  protocol.handle('media', serveMedia);
  for (const [name, fn] of Object.entries(api)) {
    ipcMain.handle(name, (_event, ...args: unknown[]) => (fn as (...a: unknown[]) => unknown)(...args));
  }
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 820,
    minHeight: 560,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#191c20',
    webPreferences: { preload: path.join(import.meta.dirname, '../preload/index.cjs') },
  });
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(path.join(import.meta.dirname, '../renderer/index.html'));
  void ensureTools((tools) => emit('tools', tools));
});

app.on('window-all-closed', () => {
  previewJob?.abort();
  agent.stop();
  app.quit();
});
