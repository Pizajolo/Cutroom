import { app, BrowserWindow, dialog, protocol, session } from 'electron';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emit } from './ipc';
import { registerStartupIpc } from './ipc/startup';
import { appResponse } from './protocol';
import { readManifest } from './tools/manifest';
import { ToolRegistry } from './tools/registry';
import { startMediaServer } from './server/mediaServer';
import { startCompositionServer } from './server/compositionServer';
import { MediaService } from './media/service';
import { stopMediaProcesses } from './media/process';
import { SettingsStore } from './settings/store';
import { ToolInstaller } from './tools/installer';
import { WhisperModels } from './whisper/models';
import { AccountsService } from './accounts/service';
import { KeychainSecrets } from './secrets/keychain';
import { ClaudeCodeService } from './claude/service';
import { configureClaudeAgentEnv } from './claude/env';
import { WorkflowRuntime } from './projects/runtime';
import { allowAudioPermission } from './permissions';

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
    const appUrl = !app.isPackaged && process.env.ELECTRON_RENDERER_URL ? process.env.ELECTRON_RENDERER_URL : 'app://cutroom/';
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
      callback(allowAudioPermission({ permission, origin: details.requestingUrl, mainFrame: details.isMainFrame && BrowserWindow.getAllWindows().some((window) => window.webContents === contents), mediaTypes: 'mediaTypes' in details ? details.mediaTypes : undefined }, appUrl));
    });
    // The check API does not specify requested media types; defer to the request handler.
    session.defaultSession.setPermissionCheckHandler(() => false);
    const homeDir = path.resolve(process.env.CUTROOM_HOME ?? path.join(homedir(), '.cutroom'));
    const settings = await SettingsStore.load(homeDir);
    const resources = app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'resources');
    const manifest = await readManifest(path.join(resources, 'tools-manifest.json'));
    const registry = new ToolRegistry({
      home: homeDir, arch: process.arch,
      bundledRoot: app.isPackaged ? path.join(resources, 'bin') : path.join(resources, 'bin', process.arch),
      manifest,
      onChanged: (tools) => emit('tools.changed', tools),
    });
    await registry.initialize();
    const installer = new ToolInstaller({ registry });
    const models = new WhisperModels({ home: homeDir, pins: manifest.models, settings, onChanged: (models) => emit('models.changed', models) });
    await models.initialize();
    const claude = new ClaudeCodeService();
    const secrets = new KeychainSecrets();
    const accounts = new AccountsService({ settings, secrets, claudeCode: claude, onChanged: (accounts) => emit('accounts.changed', accounts) });
    configureClaudeAgentEnv(accounts);
    const mediaRef: { current?: MediaService } = {};
    const server = await startMediaServer({
      projectRoot: (id) => mediaRef.current?.rootFor(id),
      devOrigin: !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined,
    });
    const media = new MediaService({
      resolveTool: (name) => registry.resolve(name), url: server.url,
      onChanged: (projectId, rels) => emit('media.changed', { projectId, rels }),
      onProgress: (progress) => emit('media.progress', progress),
    });
    mediaRef.current = media;
    const compositionsRoot = path.join(here, '../compositions');
    const compositionServer = await startCompositionServer({ projectRoot: (id) => media.rootFor(id), compositionsRoot, mediaBaseUrl: server.baseUrl, devOrigin: !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined });
    const workflows = new WorkflowRuntime({ home: homeDir, media, store: settings, secrets, compositionsRoot, compositionBaseUrl: compositionServer.baseUrl, resolveModel: (name) => models.resolve(name), resolveTool: (name) => registry.resolve(name), emit });
    registerStartupIpc({ registry, media, installer, models, accounts, claude, workflows, getInfo: () => ({
      version: app.getVersion(), platform: process.platform, arch: process.arch,
      homeDir, mediaBaseUrl: server.baseUrl, compBaseUrl: compositionServer.baseUrl,
    }) });
    protocol.handle('app', (request) => appResponse(request, path.join(here, '../renderer'), server.baseUrl, compositionServer.baseUrl));
    let closing = false; let closed = false;
    app.on('before-quit', (event) => {
      if (closed) return;
      event.preventDefault(); if (closing) return; closing = true;
      media?.close();
      void Promise.allSettled([workflows.close(), server.close(), compositionServer.close(), stopMediaProcesses(), installer.close(), models.close(), accounts.close()]).finally(() => { closed = true; app.quit(); });
    });
    createWindow();
    void accounts.verifyConnected();
    if (process.env.CUTROOM_NO_AUTO_DOWNLOAD !== '1') {
      void (async () => {
        await installer.ensureAll();
        if (closing) return;
        await models.ensureDefault();
        if (!closing) await installer.checkUpdate('yt-dlp', true).catch(() => undefined);
      })().catch(() => undefined);
    }
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  }).catch(() => {
    dialog.showErrorBox('Cutroom could not start', 'The local media service or tools directory could not be initialized. Check directory permissions and local network binding permissions.');
    app.quit();
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
