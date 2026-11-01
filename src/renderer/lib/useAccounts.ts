import type { AccountInfo } from '@shared/schema/accounts';
import { api } from './api';
import { createLiveResource } from './liveResource';

const accounts = createLiveResource(() => api.invoke('accounts.list', {}), (receive) => api.on('accounts.changed', receive), 'Connections could not be checked.');
export const useAccounts = accounts.useResource;
export const accountRevision = accounts.revision;
export function receiveAccount(account: AccountInfo, revision: number) {
  accounts.update((list) => list.map((entry) => entry.provider === account.provider ? account : entry), revision);
}
export function accountMethodLabel(account: AccountInfo) {
  return account.method === 'claude-code' ? 'Claude Code sign-in' : 'API key';
}
