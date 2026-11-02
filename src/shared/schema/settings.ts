import { z } from 'zod/v3';
import { accountMethodSchema, accountStatusSchema, keyPreviewSchema } from './accounts';
import { whisperModelNameSchema } from './models';
import { exportPresetSchema } from './export';
import { storedExtensionSchema } from './extensions';

export const savedAccountStateSchema = z.object({
  keyPreview: keyPreviewSchema.nullable(), checkedAt: z.string().datetime().nullable(), status: accountStatusSchema,
}).strict();
const disconnected = { keyPreview: null, checkedAt: null, status: 'not_connected' as const };
const shared = {
  appearance: z.enum(['system', 'light', 'dark']), defaultEngine: z.enum(['hyperframes', 'remotion']),
  claude: z.object({ auth: accountMethodSchema, credentialRef: z.string().optional() }).strict(),
  elevenLabs: z.object({ apiKeyRef: z.string().optional(), oauthRef: z.string().optional() }).strict(),
  openai: z.object({ apiKeyRef: z.string().optional() }).strict().default({}),
  accounts: z.object({ anthropic: savedAccountStateSchema, openai: savedAccountStateSchema, elevenlabs: savedAccountStateSchema }).strict()
    .default({ anthropic: disconnected, openai: disconnected, elevenlabs: disconnected }),
  whisperModel: whisperModelNameSchema,
  whisperAutoDownloadSuppressed: z.array(whisperModelNameSchema).max(4).default([]),
  remotionLicenseAcknowledgedAt: z.string().datetime().nullable(),
};
export const globalSettingsV1Schema = z.object({
  ...shared, version: z.literal(1), voiceInput: z.enum(['whisper', 'scribe']),
  sandbox: z.object({ networkByDefault: z.literal(false), allowedDomains: z.array(z.string()) }).strict(),
  snapshots: z.object({ retainDays: z.number().int().positive(), maxBytes: z.number().int().positive() }).strict(),
  renderPreset: z.enum(['draft', 'final']),
}).strict();
export const voiceInputSettingsSchema = z.object({ engine: z.enum(['whisper', 'scribe']), model: z.string().min(1).max(200) }).strict();
export const sandboxSettingsSchema = z.object({
  networkByDefault: z.literal(false), allowShell: z.literal(false), allowWeb: z.literal(false), allowedDomains: z.array(z.string()),
}).strict();
export const snapshotSettingsSchema = z.object({
  retainDays: z.number().int().positive(), maxBytes: z.number().int().positive(), autoBeforeAgent: z.boolean(), autoBeforeExport: z.boolean(),
}).strict();
export const renderPresetsSettingsSchema = z.object({
  defaultId: z.string().min(1), custom: z.array(exportPresetSchema.refine((preset) => !preset.builtin, 'Custom presets cannot be builtin')).max(100),
}).strict().refine((settings) => new Set(settings.custom.map((preset) => preset.id)).size === settings.custom.length, 'Duplicate preset ids');
// Credentials are Keychain references only; never persist tokens or API keys here.
export const globalSettingsSchema = z.object({
  ...shared, version: z.literal(2), voiceInput: voiceInputSettingsSchema, sandbox: sandboxSettingsSchema,
  snapshots: snapshotSettingsSchema, renderPresets: renderPresetsSettingsSchema, extensions: z.array(storedExtensionSchema).max(100),
}).strict();
export type GlobalSettings = z.infer<typeof globalSettingsSchema>;
// Authentication and extensions have their own mutation channels; no credential references in patches.
export const settingsPatchSchema = z.object({
  appearance: shared.appearance.optional(), defaultEngine: shared.defaultEngine.optional(),
  voiceInput: voiceInputSettingsSchema.partial().optional(), whisperModel: shared.whisperModel.optional(),
  remotionLicenseAcknowledgedAt: shared.remotionLicenseAcknowledgedAt.optional(),
  renderPresets: renderPresetsSettingsSchema.optional(), sandbox: sandboxSettingsSchema.partial().optional(), snapshots: snapshotSettingsSchema.partial().optional(),
}).strict();
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;
export function migrateGlobalSettings(value: unknown): GlobalSettings {
  // Previous v1 settings used "subscription" for the Claude Code login.
  const input: unknown = structuredClone(value);
  if (input && typeof input === 'object' && 'claude' in input && input.claude && typeof input.claude === 'object' && 'auth' in input.claude && input.claude.auth === 'subscription') input.claude.auth = 'claude-code';
  if (input && typeof input === 'object' && 'version' in input && input.version === 1) {
    const { voiceInput, renderPreset, sandbox, snapshots, ...rest } = globalSettingsV1Schema.parse(input);
    return globalSettingsSchema.parse({
      ...rest, version: 2, voiceInput: { engine: voiceInput, model: voiceInput === 'whisper' ? rest.whisperModel : 'scribe_v1' },
      renderPresets: { defaultId: renderPreset, custom: [] }, sandbox: { ...sandbox, allowShell: false, allowWeb: false },
      snapshots: { ...snapshots, autoBeforeAgent: true, autoBeforeExport: true }, extensions: [],
    });
  }
  return globalSettingsSchema.parse(input);
}
export function defaultGlobalSettings(): GlobalSettings {
  return globalSettingsSchema.parse({
    version: 2, appearance: 'system', defaultEngine: 'hyperframes', claude: { auth: 'claude-code' }, elevenLabs: {},
    voiceInput: { engine: 'whisper', model: 'base' }, whisperModel: 'base', remotionLicenseAcknowledgedAt: null,
    sandbox: { networkByDefault: false, allowShell: false, allowWeb: false, allowedDomains: [] },
    snapshots: { retainDays: 30, maxBytes: 10 * 1024 ** 3, autoBeforeAgent: true, autoBeforeExport: true },
    renderPresets: { defaultId: 'draft', custom: [] }, extensions: [],
  });
}
