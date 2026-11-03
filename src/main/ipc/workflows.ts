import { dialog, shell } from 'electron';
import path from 'node:path';
import { z } from 'zod/v3';
import { IpcFailure, type InvokeChannel, type InvokeReq, type InvokeRes } from '@shared/ipc/contract';
import { handle } from './index';
import { PathError, resolveInProject } from '../fs/safePath';
import type { WorkflowRuntime } from '../projects/runtime';
import { exportPresets } from '../render/presets';
import { ToolUnavailable } from '../tools/registry';

export function workflowHandle<C extends InvokeChannel>(channel: C, action: (request: InvokeReq<C>) => InvokeRes<C> | Promise<InvokeRes<C>>): void {
  handle(channel, async (request) => {
    try { return await action(request); }
    catch (error) {
      if (error instanceof IpcFailure) throw error;
      if (error instanceof PathError) throw new IpcFailure({ code: 'forbidden', message: error.message });
      if (error instanceof z.ZodError || error instanceof SyntaxError) throw new IpcFailure({ code: 'invalid_request', message: 'The saved document is invalid. Restore a valid snapshot or repair it before continuing.' });
      if (error instanceof ToolUnavailable) throw new IpcFailure({ code: 'unavailable', message: `${error.tool} is unavailable. Open Settings → Tools to install or repair it.` });
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') throw new IpcFailure({ code: 'not_found', message: 'The requested file or folder no longer exists.' });
      throw new IpcFailure({ code: 'internal', message: 'This operation could not be completed. Check folder permissions and available disk space.' });
    }
  });
}
export async function legacySelectProject(runtime: WorkflowRuntime): Promise<InvokeRes<'media.selectProjectFolder'>> {
  const result = await dialog.showOpenDialog({ title: 'Open a media project folder', properties: ['openDirectory'] });
  if (result.canceled || !result.filePaths[0]) return null;
  const grant = await runtime.projects.grants.issue(result.filePaths[0], 'openProject');
  const opened = await runtime.projects.open({ grantId: grant.grantId });
  const session = opened.status === 'opened' ? opened.session : await runtime.projects.createInPlace({ grantId: opened.grantId, name: path.basename(opened.displayPath) || 'Untitled', defaultEngine: runtime.settings.get().defaultEngine, format: { aspect: '16:9', width: 1920, height: 1080, fps: 30 } });
  return { id: session.project.id, root: session.rootPath };
}
export function registerWorkflowIpc(runtime: WorkflowRuntime): void {
  workflowHandle('dialog.pickFolder', async ({ purpose }) => {
    const result = await dialog.showOpenDialog({ title: purpose === 'footage' ? 'Choose footage to copy' : purpose === 'projectParent' ? 'Choose where to create the project' : 'Open a project folder', properties: ['openDirectory'] });
    return result.canceled || !result.filePaths[0] ? null : runtime.projects.grants.issue(result.filePaths[0], purpose);
  });
  workflowHandle('project.create', (request) => runtime.projects.create(request));
  workflowHandle('project.retryFootageImport', ({ retryId }) => runtime.projects.retryFootageImport(retryId));
  workflowHandle('project.createInPlace', (request) => runtime.projects.createInPlace(request));
  workflowHandle('project.open', (request) => runtime.projects.open(request));
  workflowHandle('project.current', () => runtime.projects.current());
  workflowHandle('project.close', () => runtime.projects.close());
  workflowHandle('project.listRecent', () => runtime.projects.listRecent());
  workflowHandle('project.removeRecent', ({ id }) => runtime.projects.removeRecent(id));
  workflowHandle('project.adoptLooseMedia', ({ rels }) => runtime.projects.adoptLooseMedia(rels));
  workflowHandle('timeline.get', () => runtime.timeline().state());
  workflowHandle('timeline.apply', ({ ops, label, baseRevision }) => runtime.timeline().apply(ops, { actor: 'user', label, baseRevision }));
  workflowHandle('timeline.undo', () => runtime.timeline().undo());
  workflowHandle('timeline.redo', () => runtime.timeline().redo());
  workflowHandle('timeline.history', () => runtime.timeline().history());
  workflowHandle('snapshots.list', () => runtime.timeline().snapshots());
  workflowHandle('snapshots.create', ({ label }) => runtime.timeline().createSnapshot(label));
  workflowHandle('snapshots.restore', ({ id }) => runtime.timeline().restoreSnapshot(id));
  workflowHandle('snapshots.delete', ({ id }) => runtime.timeline().deleteSnapshot(id));
  workflowHandle('storage.usage', () => runtime.storage.usage());
  workflowHandle('storage.cleanPreview', ({ categories }) => runtime.storage.preview(categories));
  workflowHandle('storage.clean', ({ token }) => runtime.storage.clean(token));
  workflowHandle('agent.sessions.list', () => runtime.agent.list());
  workflowHandle('agent.start', (request) => runtime.agent.start(request));
  workflowHandle('agent.send', (request) => runtime.agent.send(request));
  workflowHandle('agent.interrupt', ({ sessionId }) => runtime.agent.interrupt(sessionId));
  workflowHandle('agent.respondPermission', (request) => runtime.agent.respond(request));
  workflowHandle('agent.review.keep', ({ requestId, itemIds }) => { runtime.agent.review.keep(requestId, itemIds); return runtime.timeline().state(); });
  workflowHandle('agent.review.revert', ({ requestId, itemIds, resolution }) => runtime.agent.review.revert(runtime.timeline(), requestId, itemIds, resolution));
  workflowHandle('urlImport.fetch', ({ url }) => runtime.urls.fetch(url));
  workflowHandle('urlImport.download', (request) => runtime.urls.download(request));
  workflowHandle('transcripts.get', ({ rel }) => runtime.transcripts.get(rel));
  workflowHandle('transcripts.start', (request) => runtime.transcripts.start(request));
  workflowHandle('captions.generate', ({ clipItemId }) => runtime.transcripts.captions(clipItemId));
  workflowHandle('voice.transcribe', (request) => runtime.transcripts.voice(request));
  workflowHandle('audio.voices', () => runtime.audio.voices());
  workflowHandle('audio.estimate', (request) => runtime.audio.estimate(request));
  workflowHandle('audio.generate', (request) => runtime.audio.generate(request));
  workflowHandle('compositions.templates', () => runtime.compositions.templates());
  workflowHandle('compositions.list', () => runtime.compositions.list());
  workflowHandle('compositions.create', ({ template, name }) => runtime.compositions.create(template, name));
  workflowHandle('compositions.check', ({ name }) => runtime.compositions.check(name));
  workflowHandle('compositions.render', ({ itemId }) => runtime.overlays.start(itemId));
  workflowHandle('accounts.codex.status', () => runtime.codex.status());
  workflowHandle('accounts.codex.openLogin', () => runtime.codex.openLogin());
  workflowHandle('extensions.list', () => runtime.extensions.list());
  workflowHandle('extensions.validate', ({ config }) => runtime.extensions.validate(config));
  workflowHandle('extensions.add', (request) => runtime.extensions.add(request));
  workflowHandle('extensions.remove', ({ id }) => runtime.extensions.remove(id));
  workflowHandle('extensions.setEnabled', ({ id, enabled }) => runtime.extensions.setEnabled(id, enabled));
  workflowHandle('settings.get', () => runtime.settings.get());
  workflowHandle('settings.update', ({ patch }) => runtime.settings.update(patch));
  workflowHandle('jobs.list', () => runtime.jobs.list(runtime.projects.current()?.project.id));
  workflowHandle('jobs.cancel', ({ id }) => runtime.jobs.cancel(id));
  workflowHandle('export.presets', () => exportPresets(runtime.settings.get()));
  workflowHandle('export.preflight', (request) => runtime.exports.preflight(request));
  workflowHandle('export.start', (request) => runtime.exports.start(request));
  workflowHandle('shell.openInProject', async ({ rel }) => {
    if (!/\.(mp4|mov|webm|mkv|wav|mp3|m4a|aac|flac|ogg)$/i.test(rel)) throw new IpcFailure({ code: 'forbidden', message: 'Only rendered media or audio files can be opened.' });
    const file = await resolveInProject(runtime.projects.require().rootPath, rel);
    if (await shell.openPath(file)) throw new IpcFailure({ code: 'unavailable', message: 'No application could open this media file.' });
    return { ok: true };
  });
}
