import { IpcFailure } from '@shared/ipc/errors';
import { providerSchema, type Provider } from '@shared/schema/accounts';

export interface SecretStore { get(provider: Provider): Promise<string | null>; set(provider: Provider, value: string): Promise<void>; delete(provider: Provider): Promise<void> }
interface KeyringEntry { getPassword(): string | null; setPassword(value: string): void; deleteCredential(): boolean }
interface KeyringModule { Entry: new (service: string, account: string) => KeyringEntry }
export class KeychainSecrets implements SecretStore {
  private async entry(provider: Provider): Promise<KeyringEntry> {
    providerSchema.parse(provider);
    try {
      // Lazy import: a missing native optional package must never prevent app startup.
      const packageName = '@napi-rs/keyring'; const loaded: unknown = await import(packageName);
      if (!loaded || typeof loaded !== 'object' || !('Entry' in loaded) || typeof loaded.Entry !== 'function') throw new Error('Native module unavailable.');
      return new (loaded as KeyringModule).Entry('dev.cutroom.app', `${provider}-api-key`);
    } catch { throw new IpcFailure({ code: 'unavailable', message: 'The macOS Keychain is unavailable. Unlock your login Keychain and check the app installation.' }); }
  }
  async get(provider: Provider): Promise<string | null> { try { return (await this.entry(provider)).getPassword(); } catch { throw this.failure(); } }
  async set(provider: Provider, value: string): Promise<void> { try { (await this.entry(provider)).setPassword(value); } catch { throw this.failure(); } }
  async delete(provider: Provider): Promise<void> { try { (await this.entry(provider)).deleteCredential(); } catch { throw this.failure(); } }
  private failure(): IpcFailure { return new IpcFailure({ code: 'unavailable', message: 'The macOS Keychain is unavailable. Unlock your login Keychain and retry.' }); }
}
