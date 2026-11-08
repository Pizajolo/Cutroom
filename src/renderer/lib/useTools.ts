import type { InstallState, ToolInfo } from '@shared/schema/media';
import type { WhisperModelInfo } from '@shared/schema/models';
import { api } from './api';
import { createLiveResource } from './liveResource';

const tools = createLiveResource(() => api.invoke('tools.list', {}), (receive) => api.on('tools.changed', receive), 'Tools could not be checked.');
const models = createLiveResource(() => api.invoke('models.list', {}), (receive) => api.on('models.changed', receive), 'Models could not be checked.');
export const useTools = tools.useResource;
export const useModels = models.useResource;
export const modelRevision = models.revision;
export function receiveModels(list: WhisperModelInfo[], revision: number) { models.update(() => list, revision); }
export const isInstalling = (install: InstallState | null) => !!install && install.state !== 'failed';
export function downloadPercent(install: InstallState) {
  return (install.state === 'downloading' || install.state === 'building') && install.total !== null && install.total > 0
    ? Math.round(Math.max(0, Math.min(100, install.received / install.total * 100))) : undefined;
}
export function setupProgress(tools: ToolInfo[] | null, models: WhisperModelInfo[] | null) {
  const installs = [...(tools ?? []), ...(models ?? []).filter((model) => model.isDefault)].map((item) => item.install);
  const active = installs.filter((install): install is InstallState => isInstalling(install));
  const failed = installs.some((install) => install?.state === 'failed') || (tools ?? []).some((tool) => tool.status === 'checksum_mismatch');
  const determinate = active.length > 0 && active.every((install) => install.state === active[0]!.state && downloadPercent(install) !== undefined);
  const total = active.reduce((sum, install) => sum + (install.total ?? 0), 0);
  const percent = determinate && total > 0 ? Math.round(active.reduce((sum, install) => sum + Math.min(install.received, install.total ?? 0), 0) / total * 100) : undefined;
  return { busy: active.length > 0, failed, percent };
}
export function formatSize(bytes: number) {
  return bytes >= 1_000_000_000 ? `${(bytes / 1_000_000_000).toFixed(2)} GB` : `${Math.round(bytes / 1_000_000)} MB`;
}
