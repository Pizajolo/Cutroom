// The only bridge between the UI and the main process: `window.cutroom`.
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { CutroomApi } from '../shared/types';

const METHODS = [
  'openProject', 'recentProjects', 'openRecent', 'importFiles', 'downloadLinks', 'listMedia', 'getTimeline', 'saveTimeline',
  'cuts', 'switchCut', 'newCut', 'splitCut', 'renameCut', 'setCutBrand', 'deleteCut', 'loadChat', 'saveChat', 'send', 'stop', 'exportVideo', 'reveal', 'listSkills', 'tools',
  'closeProject', 'forgetProject', 'revealSkill', 'readSkill', 'toggleFavorite', 'saveSkill', 'removeExample', 'deleteSkill', 'getSettings', 'saveSettings', 'claudeStatus',
  'claudeLogin', 'codexStatus', 'codexLogin', 'voices', 'micAccess', 'cloneVoice', 'deleteVoice', 'getScript', 'approveSpokenCut', 'versions', 'markFinal', 'ledger', 'features', 'setProjectFeature', 'duration', 'getModel', 'setProjectModel',
  'marketAccount', 'marketLogin', 'marketLogout', 'marketSetServer', 'marketOpenWeb', 'marketBrowse', 'marketDetail', 'marketInstall', 'marketUninstall',
  'marketInstalled', 'marketFavorites', 'marketSetFavorite', 'marketReview', 'marketDeleteReview', 'marketReport', 'marketBuy', 'marketPublish', 'marketMine',
  'marketUpdateOwn', 'brain', 'checkUpdate', 'downloadUpdate',
  'listBrands', 'createBrand', 'saveBrand', 'deleteBrand', 'addBrandFiles', 'removeBrandFile', 'revealBrand',
  'brandChat', 'brandChatSend', 'brandChatAttach', 'brandChatStop', 'brandChatReset', 'readBrandImage', 'liftImage', 'saveLogo', 'exportBrand', 'openExport', 'importBrand', 'lookupFont', 'fetchFont',
  'logoChat', 'logoChatSend', 'logoChatStop', 'logoChatReset', 'logoChatAttach', 'logoDrafts', 'useLogoDraft',
  'socialStatus', 'socialOpen', 'socialSaveLogin', 'socialForgetLogin', 'socialSignIn', 'socialSignOut', 'socialCheckNow',
  'socialExports', 'socialChat', 'socialChatSend', 'socialChatStop', 'socialChatReset', 'socialPost', 'socialDiscard', 'socialShowWindow',
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

// The page leaves room for the macOS window buttons only while they are there: not in full screen, not on other systems.
const mac = process.platform === 'darwin';
let fullScreen = false;
const markWindow = (): void => void document.documentElement?.classList.toggle('no-window-buttons', !mac || fullScreen);
window.addEventListener('DOMContentLoaded', markWindow);
ipcRenderer.on('fullscreen', (_event, on: boolean) => {
  fullScreen = on;
  markWindow();
});
