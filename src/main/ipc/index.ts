import { app, BrowserWindow, ipcMain } from 'electron';
import { contract, type EventName, type EventPayload, type InvokeChannel, type InvokeReq, type InvokeRes } from '@shared/ipc/contract';
import { createRequestHandler, reply, validatedEmit } from './validation';

export function handle<C extends InvokeChannel>(channel: C, impl: (request: InvokeReq<C>) => Promise<InvokeRes<C>> | InvokeRes<C>): void {
  const execute = createRequestHandler<(typeof contract.invoke)[C]['req'], (typeof contract.invoke)[C]['res']>(contract.invoke[channel], impl, {
    devUrl: !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined,
    validateResponse: !app.isPackaged,
  });
  ipcMain.handle(channel, (event, request: unknown) => reply(() => execute({
    frameUrl: event.senderFrame?.url ?? '',
    isMainFrame: event.senderFrame !== null && event.senderFrame === event.sender.mainFrame,
    destroyed: event.sender.isDestroyed(),
  }, request)));
}
export function emit<E extends EventName>(event: E, payload: EventPayload<E>): boolean {
  return validatedEmit(contract.events[event], payload, (validated) => {
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(event, validated);
  });
}
