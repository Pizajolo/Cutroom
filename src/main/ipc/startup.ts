import type { InvokeRes } from '@shared/ipc/contract';
import { handle } from './index';
import { registerMediaIpc } from '../media/ipc';
import { registerSettingsIpc } from './settings';
import { registerStubIpc } from './stubs';
import { legacySelectProject, registerWorkflowIpc } from './workflows';
import type { WorkflowRuntime } from '../projects/runtime';

export interface StartupIpcServices {
  registry: Parameters<typeof registerMediaIpc>[0];
  media: Parameters<typeof registerMediaIpc>[1];
  installer: Parameters<typeof registerSettingsIpc>[0];
  models: Parameters<typeof registerSettingsIpc>[1];
  accounts: Parameters<typeof registerSettingsIpc>[2];
  claude: Parameters<typeof registerSettingsIpc>[3];
  workflows: WorkflowRuntime;
  getInfo: () => InvokeRes<'app.getInfo'>;
}
// Single startup entry point, exercised by the handler-coverage test.
export function registerStartupIpc(services: StartupIpcServices): void {
  registerMediaIpc(services.registry, services.media, () => legacySelectProject(services.workflows));
  registerWorkflowIpc(services.workflows);
  registerSettingsIpc(services.installer, services.models, services.accounts, services.claude);
  registerStubIpc(handle);
  handle('app.ping', () => ({ pong: true }));
  handle('app.getInfo', services.getInfo);
}
