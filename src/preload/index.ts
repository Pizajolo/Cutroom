import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import { createBridge } from './bridge';

declare const __IPC_INVOKE_CHANNELS__: readonly string[];
declare const __IPC_EVENT_CHANNELS__: readonly string[];

contextBridge.exposeInMainWorld('cutroom', createBridge({
  invoke: (channel, request) => ipcRenderer.invoke(channel, request),
  subscribe: (channel, callback) => {
    const listener = (_event: IpcRendererEvent, payload: unknown): void => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => { ipcRenderer.removeListener(channel, listener); };
  },
  getPathForFile: (file) => webUtils.getPathForFile(file),
}, { invoke: __IPC_INVOKE_CHANNELS__, events: __IPC_EVENT_CHANNELS__ }));
