// The only bridge between the UI and the main process: `window.cutroom`.
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { CutroomApi } from '../shared/types';

const METHODS = [
  'openProject', 'recentProjects', 'openRecent', 'importFiles', 'downloadLinks', 'listMedia', 'getTimeline', 'saveTimeline',
  'loadChat', 'saveChat', 'send', 'stop', 'exportVideo', 'reveal', 'listSkills', 'tools',
  'closeProject', 'forgetProject', 'revealSkill', 'readSkill', 'saveSkill', 'removeExample', 'deleteSkill', 'getSettings', 'saveSettings', 'claudeStatus',
  'claudeLogin', 'codexStatus', 'codexLogin', 'voices', 'micAccess', 'cloneVoice', 'deleteVoice', 'getScript', 'features', 'setProjectFeature', 'duration', 'getModel', 'setProjectModel',
] as const;

const api = {
  ...Object.fromEntries(METHODS.map((name) => [name, (...args: unknown[]) => ipcRenderer.invoke(name, ...args)])),
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  on(channel: string, fn: (payload: unknown) => void) {
    const listener = (_event: unknown, payload: unknown): void => fn(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
} as unknown as CutroomApi;

contextBridge.exposeInMainWorld('cutroom', api);
