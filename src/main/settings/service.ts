import { IpcFailure } from '@shared/ipc/errors';
import { settingsPatchSchema, type GlobalSettings, type SettingsPatch } from '@shared/schema/settings';
import { BUILTIN_PRESETS, exportPresets } from '../render/presets';
import type { SettingsStore } from './store';

export function validDomain(domain: string): boolean {
  return domain.length <= 253 && /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(domain);
}
export class SettingsService {
  constructor(readonly store: SettingsStore, private readonly onChanged: (settings: GlobalSettings) => void) {}
  get(): GlobalSettings { return this.store.get(); }
  async update(input: SettingsPatch): Promise<GlobalSettings> {
    const patch = settingsPatchSchema.parse(input);
    if (patch.sandbox?.allowedDomains && (patch.sandbox.allowedDomains.length > 50 || patch.sandbox.allowedDomains.some((domain) => !validDomain(domain)))) throw new IpcFailure({ code: 'invalid_request', message: 'Allowed domains must be hostnames only (maximum 50), without a scheme, wildcard or path.' });
    const value = await this.store.update((draft) => {
      if (patch.appearance !== undefined) draft.appearance = patch.appearance;
      if (patch.defaultEngine !== undefined) draft.defaultEngine = patch.defaultEngine;
      if (patch.remotionLicenseAcknowledgedAt !== undefined) draft.remotionLicenseAcknowledgedAt = patch.remotionLicenseAcknowledgedAt;
      if (patch.sandbox) draft.sandbox = { ...draft.sandbox, ...patch.sandbox };
      if (patch.snapshots) draft.snapshots = { ...draft.snapshots, ...patch.snapshots };
      if (patch.voiceInput) draft.voiceInput = { ...draft.voiceInput, ...patch.voiceInput };
      if (patch.agent) draft.agent = { ...draft.agent, ...patch.agent };
      if (patch.whisperModel) { draft.whisperModel = patch.whisperModel; if (draft.voiceInput.engine === 'whisper') draft.voiceInput.model = patch.whisperModel; }
      if (draft.voiceInput.engine === 'scribe' && draft.accounts.elevenlabs.status !== 'connected') throw new IpcFailure({ code: 'invalid_request', message: 'Connect ElevenLabs in Accounts before choosing Scribe voice input.' });
      if (patch.renderPresets) {
        if (patch.renderPresets.custom.some((preset) => BUILTIN_PRESETS.some((builtin) => builtin.id === preset.id))) throw new IpcFailure({ code: 'invalid_request', message: 'Built-in presets cannot be modified.' });
        draft.renderPresets = patch.renderPresets;
      }
      if (!exportPresets(draft).some((preset) => preset.id === draft.renderPresets.defaultId)) throw new IpcFailure({ code: 'invalid_request', message: 'The default render preset must exist. Select another default before deleting it.' });
    });
    this.onChanged(value); return value;
  }
}
