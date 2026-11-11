// Electron shell: one window, the project folder, a preview that follows the timeline, and IPC.
import { createReadStream, watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { BrowserWindow, app, dialog, ipcMain, protocol, shell } from 'electron';
import { readTimeline, render } from '../cli/render';
import { run } from '../cli/run';
import { LIBRARY } from '../cli/project';
import { PREVIEW_FILE, PROJECT_DIRS, SCRIPT_FILE, TIMELINE_FILE } from '../shared/types';
import type { ChatMessage, CutroomApi, Mark, Project, Script, Timeline } from '../shared/types';
import * as agent from './agent';
import { downloadLinks, forgetProject, importFiles, listMedia, openProject, recentProjects } from './project';
import { claudeLogin, claudeStatus, cloneVoice, codexLogin, codexStatus, deleteVoice, features, loadSettings, micAccess, modelChoice, saveSettings, setProjectFeature, setProjectModel, voices } from './settings';
import { ensureTools, toolStatus } from './tools';

let win: BrowserWindow | undefined;
let project: Project | null = null;
let timeline: Timeline | null = null;
let watcher: FSWatcher | undefined;
let previewJob: AbortController | undefined;
let previewVersion = 0;

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
    timeline = await readTimeline(root());
    emit('timeline', timeline);
    if (!timeline?.clips.length) return emit('preview', { rendering: false, version: 0 });
    emit('preview', { rendering: true, version: previewVersion });
    await render(root(), { preview: true, signal: job.signal });
    previewVersion = Date.now();
    emit('preview', { rendering: false, version: previewVersion });
  } catch (error) {
    if (!job.signal.aborted) emit('preview', { rendering: false, version: previewVersion, error: (error as Error).message });
  }
}

/** The script awaits approval when it is newer than the edit (or there is no edit yet). */
async function readScript(dir: string): Promise<Script> {
  const file = path.join(dir, SCRIPT_FILE);
  const text = await readFile(file, 'utf8').catch(() => '');
  const [written, edited] = await Promise.all([file, path.join(dir, TIMELINE_FILE)].map((f) => stat(f).then((s) => s.mtimeMs, () => 0)));
  return { text, pending: !!text && written! > edited! };
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
      const used = new Set([TIMELINE_FILE, ...(timeline ? [...timeline.overlays, ...timeline.audio].map((i) => i.src) : [])]);
      if (files.some((f) => used.has(f))) void refresh();
      if (files.includes(SCRIPT_FILE) || files.includes(TIMELINE_FILE)) emit('script', await readScript(dir));
      if (files.some((f) => PROJECT_DIRS.some((d) => f.startsWith(`${d}/`)))) emit('media', await listMedia(dir));
    }, 300);
  });
}

async function open(dir: string): Promise<Project> {
  agent.stop();
  project = await openProject(dir);
  timeline = null;
  // Start from this project's own last preview (if any), never the previous project's.
  previewVersion = await stat(path.join(dir, PREVIEW_FILE)).then((s) => Math.round(s.mtimeMs), () => 0);
  watchProject(dir);
  void refresh();
  return project;
}

// --- IPC ---------------------------------------------------------------------------------

const chatFile = (): string => path.join(root(), '.cutroom/chat.json');

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
  saveTimeline: (next) => writeFile(path.join(root(), TIMELINE_FILE), JSON.stringify(next, null, 2)),
  loadChat: async () => JSON.parse(await readFile(chatFile(), 'utf8').catch(() => '[]')) as ChatMessage[],
  saveChat: (messages) => writeFile(chatFile(), JSON.stringify(messages)),
  send: (text: string, marks: Mark[], files: string[]) =>
    agent.send(root(), text, marks, files, timeline, (event) => {
      emit('agent', event);
      // Catch anything the watcher missed (e.g. a graphic re-rendered in place) once the turn ends.
      if (event.type === 'done') void refresh();
    }),
  stop: async () => agent.stop(),
  exportVideo: async () => path.relative(root(), await render(root())),
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
  readSkill: (id) => readFile(agent.skillFile(id), 'utf8'),
  async saveSkill(id, text) {
    await writeFile(path.join(agent.customSkillDir(id), 'SKILL.md'), text);
    return agent.listSkills();
  },
  async openVideo(file) {
    const known = (await agent.listSkills()).some((skill) => skill.videos.includes(file));
    if (known) await shell.openPath(file);
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

/** `media://project/<path>` serves files from the open project and `media://style/<name>/example.mp4` from the style library, with range requests so video can seek. */
async function serveMedia(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const base = url.host === 'style' ? path.join(LIBRARY, 'skills') : root();
  const file = path.join(base, decodeURIComponent(url.pathname));
  if (!file.startsWith(base + path.sep)) return new Response(null, { status: 403 });
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
