import { IpcFailure } from '@shared/ipc/errors';
import type { AccountsService } from '../accounts/service';
import { cleanClaudeEnv } from './service';

export function createClaudeAgentEnv(accounts: Pick<AccountsService, 'list' | 'getApiKey'>, base: NodeJS.ProcessEnv = process.env): () => Promise<Record<string, string>> {
  return async () => {
    const account = accounts.list().find((account) => account.provider === 'anthropic');
    if (account?.status !== 'connected') throw new IpcFailure({ code: 'forbidden', message: 'Connect Claude in Settings › Accounts' });
    const env = cleanClaudeEnv(base);
    if (account.method === 'claude-code') return env;
    if (account.method === 'api-key') {
      let key = await accounts.getApiKey('anthropic');
      if (!key) throw new IpcFailure({ code: 'forbidden', message: 'Connect Claude in Settings › Accounts' });
      env.ANTHROPIC_API_KEY = key; key = null; return env;
    }
    throw new IpcFailure({ code: 'forbidden', message: 'Connect Claude in Settings › Accounts' });
  };
}
let getEnvironment: (() => Promise<Record<string, string>>) | undefined;
export function configureClaudeAgentEnv(accounts: Pick<AccountsService, 'list' | 'getApiKey'>): void { getEnvironment = createClaudeAgentEnv(accounts); }
export async function claudeAgentEnv(): Promise<Record<string, string>> {
  if (!getEnvironment) throw new IpcFailure({ code: 'forbidden', message: 'Connect Claude in Settings › Accounts' });
  return getEnvironment();
}
