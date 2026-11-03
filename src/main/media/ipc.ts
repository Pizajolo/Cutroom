import { dialog, shell } from 'electron';
import { IpcFailure, type InvokeChannel, type InvokeReq, type InvokeRes } from '../../shared/ipc/contract';
import { PathError } from '../fs/safePath';
import { handle } from '../ipc';
import { ToolUnavailable, type ToolRegistry } from '../tools/registry';
import type { MediaService } from './service';

function register<C extends InvokeChannel>(channel: C, action: (request: InvokeReq<C>) => Promise<InvokeRes<C>> | InvokeRes<C>): void {
  handle(channel, async (request) => {
    try { return await action(request); }
    catch (error) {
      if (error instanceof IpcFailure) throw error;
      if (error instanceof PathError) throw new IpcFailure({ code: 'forbidden', message: error.message });
      if (error instanceof ToolUnavailable) throw new IpcFailure({ code: 'not_found', message: error.message, details: { kind: error.status, tool: error.tool } });
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') throw new IpcFailure({ code: 'not_found', message: 'The requested file no longer exists.' });
      throw new IpcFailure({ code: 'internal', message: 'The media operation could not be completed.' });
    }
  });
}
export function registerMediaIpc(registry: ToolRegistry, media: MediaService, selectProject?: () => Promise<InvokeRes<'media.selectProjectFolder'>>): void {
  register('tools.list', () => registry.list());
  register('media.selectProjectFolder', async () => {
    if (selectProject) return selectProject();
    const result = await dialog.showOpenDialog({ title: 'Browse an existing media project folder', properties: ['openDirectory'] });
    const folder = result.filePaths[0];
    return result.canceled || !folder ? null : media.selectFolder(folder);
  });
  register('media.list', () => media.list());
  register('media.importPaths', ({ paths, destination }) => media.import(paths, destination));
  register('media.importDialog', async ({ destination }) => {
    const id = media.currentId();
    const result = await dialog.showOpenDialog({ title: 'Import media', properties: ['openFile', 'multiSelections'] });
    if (result.canceled) return [];
    if (media.currentId() !== id) throw new IpcFailure({ code: 'conflict', message: 'The selected media folder changed; please import again.' });
    return media.import(result.filePaths, destination);
  });
  register('media.thumbnails', ({ rel }) => media.thumbnails(rel));
  register('media.waveform', ({ rel }) => media.waveform(rel));
  register('media.cancel', () => { media.cancel(); return { ok: true }; });
  register('shell.revealInProject', async ({ rel }) => { shell.showItemInFolder(await media.revealPath(rel)); return { ok: true }; });
}
