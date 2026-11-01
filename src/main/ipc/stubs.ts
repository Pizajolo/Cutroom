import { IpcFailure, type InvokeChannel, type InvokeReq, type InvokeRes } from '@shared/ipc/contract';

export const stubChannels = [
  'tools.install', 'tools.cancelInstall', 'tools.checkUpdate', 'tools.update',
  'models.list', 'models.download', 'models.cancel', 'models.delete', 'models.setDefault',
  'accounts.list', 'accounts.connectKey', 'accounts.disconnect', 'accounts.verify',
  'accounts.claude.setMethod', 'accounts.claudeCode.status', 'accounts.claudeCode.openLogin',
] as const satisfies readonly InvokeChannel[];

export function notImplemented(): never { throw new IpcFailure({ code: 'unavailable', message: 'Not implemented yet' }); }
export function registerStubIpc(handle: <C extends InvokeChannel>(channel: C, impl: (request: InvokeReq<C>) => InvokeRes<C> | Promise<InvokeRes<C>>) => void): void {
  for (const channel of stubChannels) handle(channel, notImplemented);
}
