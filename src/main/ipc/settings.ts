import { handle } from './index';
import type { ToolInstaller } from '../tools/installer';
import type { WhisperModels } from '../whisper/models';
import type { AccountsService } from '../accounts/service';
import type { ClaudeCodeService } from '../claude/service';

export function registerSettingsIpc(installer: ToolInstaller, models: WhisperModels, accounts: AccountsService, claude: ClaudeCodeService): void {
  handle('tools.installPrerequisite', ({ name }) => installer.installPrerequisite(name));
  handle('tools.install', async ({ name }) => { await installer.install(name); return { ok: true }; });
  handle('tools.cancelInstall', async ({ name }) => { await installer.cancel(name); return { ok: true }; });
  handle('tools.checkUpdate', ({ name }) => installer.checkUpdate(name));
  handle('tools.update', async ({ name }) => { await installer.update(name); return { ok: true }; });
  handle('models.list', () => models.list());
  handle('models.download', async ({ name }) => { await models.download(name); return { ok: true }; });
  handle('models.cancel', async ({ name }) => { await models.cancel(name); return { ok: true }; });
  handle('models.delete', async ({ name }) => { await models.delete(name); return { ok: true }; });
  handle('models.setDefault', ({ name }) => models.setDefault(name));
  handle('accounts.list', () => accounts.list());
  handle('accounts.connectKey', ({ provider, apiKey }) => accounts.connectKey(provider, apiKey));
  handle('accounts.disconnect', ({ provider }) => accounts.disconnect(provider));
  handle('accounts.verify', ({ provider }) => accounts.verify(provider));
  handle('accounts.claude.setMethod', ({ method }) => accounts.setMethod(method));
  handle('accounts.claudeCode.status', () => claude.status());
  handle('accounts.claudeCode.openLogin', async () => { await claude.openLogin(); return { ok: true }; });
}
