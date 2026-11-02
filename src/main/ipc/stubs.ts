import { IpcFailure, type InvokeChannel, type InvokeReq, type InvokeRes } from '@shared/ipc/contract';

// Build tasks must REMOVE their channels here before registering real handlers.
// Accounts, tools and media already have real handlers and must not be stubbed.
export const stubChannels = [
  'dialog.pickFolder',
  'project.create', 'project.open', 'project.createInPlace', 'project.current', 'project.close',
  'project.listRecent', 'project.removeRecent', 'project.adoptLooseMedia',
  'timeline.get', 'timeline.apply', 'timeline.undo', 'timeline.redo', 'timeline.history',
  'jobs.list', 'jobs.cancel', 'export.presets', 'export.preflight', 'export.start', 'shell.openInProject',
  'settings.get', 'settings.update', 'storage.usage', 'storage.cleanPreview', 'storage.clean',
  'snapshots.list', 'snapshots.create', 'snapshots.restore', 'snapshots.delete',
  'transcripts.get', 'transcripts.start', 'captions.generate', 'voice.transcribe',
  'urlImport.fetch', 'urlImport.download',
  'compositions.templates', 'compositions.list', 'compositions.create', 'compositions.check', 'compositions.render',
  'agent.sessions.list', 'agent.start', 'agent.send', 'agent.interrupt', 'agent.respondPermission', 'agent.review.keep', 'agent.review.revert',
  'accounts.codex.status', 'accounts.codex.openLogin',
  'audio.voices', 'audio.estimate', 'audio.generate',
  'extensions.list', 'extensions.validate', 'extensions.add', 'extensions.remove', 'extensions.setEnabled',
] as const satisfies readonly InvokeChannel[];

export function notImplemented(): never { throw new IpcFailure({ code: 'unavailable', message: 'Not implemented yet' }); }
export function registerStubIpc(handle: <C extends InvokeChannel>(channel: C, impl: (request: InvokeReq<C>) => InvokeRes<C> | Promise<InvokeRes<C>>) => void): void {
  for (const channel of stubChannels) handle(channel, notImplemented);
}
