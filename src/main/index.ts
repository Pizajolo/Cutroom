import { app, BrowserWindow, dialog, protocol, session } from 'electron';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emit, handle } from './ipc';
import { appResponse } from './protocol';
import { readManifest } from './tools/manifest';
import { ToolRegistry } from './tools/registry';
import { startMediaServer } from './server/mediaServer';
import { MediaService } from './media/service';
import { registerMediaIpc } from './media/ipc';
import { stopMediaProcesses } from './media/process';

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
const here = path.dirname(fileURLToPath(import.meta.url));

function createWindow(): void {
  const window = new BrowserWindow({
    title: 'Cutroom', width: 1440, height: 960, minWidth: 1024, minHeight: 680,
    webPreferences: {
      preload: path.join(here, '../preload/index.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
    },
  });
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-redirect', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const devUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined;
  if (devUrl) void window.loadURL(devUrl);
  else void window.loadURL('app://cutroom/');
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window) { if (window.isMinimized()) window.restore(); window.focus(); }
  });
  void app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    const homeDir = path.resolve(process.env.CUTROOM_HOME ?? path.join(homedir(), '.cutroom'));
    const resources = app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'resources');
    const registry = new ToolRegistry({
      home: homeDir, arch: process.arch,
      bundledRoot: app.isPackaged ? path.join(resources, 'bin') : path.join(resources, 'bin', process.arch),
      manifest: await readManifest(path.join(resources, 'tools-manifest.json')),
      onChanged: (tools) => emit('tools.changed', tools),
    });
    await registry.initialize();
    let media: MediaService | undefined;
    const server = await startMediaServer({
      projectRoot: (id) => media?.rootFor(id),
      devOrigin: !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined,
    });
    media = new MediaService({
      resolveTool: (name) => registry.resolve(name), url: server.url,
      onChanged: (projectId, rels) => emit('media.changed', { projectId, rels }),
      onProgress: (progress) => emit('media.progress', progress),
    });
    registerMediaIpc(registry, media);
    protocol.handle('app', (request) => appResponse(request, path.join(here, '../renderer'), server.baseUrl));
    handle('app.ping', () => ({ pong: true }));
    handle('app.getInfo', () => ({
      version: app.getVersion(), platform: process.platform, arch: process.arch,
      homeDir, mediaBaseUrl: server.baseUrl, compBaseUrl: null,
    }));
    let closing = false; let closed = false;
    app.on('before-quit', (event) => {
      if (closed) return;
      event.preventDefault(); if (closing) return; closing = true;
      media?.close();
      void Promise.all([server.close().catch(() => undefined), stopMediaProcesses()]).finally(() => { closed = true; app.quit(); });
    });
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  }).catch(() => {
    dialog.showErrorBox('Cutroom could not start', 'The local media service or tools directory could not be initialized. Check directory permissions and local network binding permissions.');
    app.quit();
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
