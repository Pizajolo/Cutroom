import { IpcFailure, type InvokeChannel, type InvokeReq, type InvokeRes } from '@shared/ipc/contract';

// Build tasks must REMOVE their channels here before registering real handlers.
// Accounts, tools and media already have real handlers and must not be stubbed.
export const stubChannels = [
  'agent.respondQuestion', 'tools.installPrerequisite',
  'skills.list', 'skills.get', 'skills.save', 'skills.delete',
] as const satisfies readonly InvokeChannel[];

export function notImplemented(): never { throw new IpcFailure({ code: 'unavailable', message: 'Not implemented yet' }); }
export function registerStubIpc(handle: <C extends InvokeChannel>(channel: C, impl: (request: InvokeReq<C>) => InvokeRes<C> | Promise<InvokeRes<C>>) => void): void {
  for (const channel of stubChannels) handle(channel, notImplemented);
}
