import { z } from 'zod/v3';
import { accountMethodSchema, accountStatusSchema, keyPreviewSchema } from './accounts';
import { whisperModelNameSchema } from './models';

export const savedAccountStateSchema = z.object({
  keyPreview: keyPreviewSchema.nullable(), checkedAt: z.string().datetime().nullable(), status: accountStatusSchema,
}).strict();
const disconnected = { keyPreview: null, checkedAt: null, status: 'not_connected' as const };

// Credentials are Keychain references only; never persist tokens or API keys here.
export const globalSettingsSchema = z.object({
  version: z.literal(1), appearance: z.enum(['system', 'light', 'dark']),
  defaultEngine: z.enum(['hyperframes', 'remotion']),
  claude: z.object({ auth: accountMethodSchema, credentialRef: z.string().optional() }).strict(),
  elevenLabs: z.object({ apiKeyRef: z.string().optional(), oauthRef: z.string().optional() }).strict(),
  openai: z.object({ apiKeyRef: z.string().optional() }).strict().default({}),
  accounts: z.object({
    anthropic: savedAccountStateSchema, openai: savedAccountStateSchema, elevenlabs: savedAccountStateSchema,
  }).strict().default({ anthropic: disconnected, openai: disconnected, elevenlabs: disconnected }),
  voiceInput: z.enum(['whisper', 'scribe']), whisperModel: whisperModelNameSchema,
  whisperAutoDownloadSuppressed: z.array(whisperModelNameSchema).max(4).default([]),
  remotionLicenseAcknowledgedAt: z.string().datetime().nullable(),
  sandbox: z.object({ networkByDefault: z.literal(false), allowedDomains: z.array(z.string()) }).strict(),
  snapshots: z.object({ retainDays: z.number().int().positive(), maxBytes: z.number().int().positive() }).strict(),
  renderPreset: z.enum(['draft', 'final']),
}).strict();
export type GlobalSettings = z.infer<typeof globalSettingsSchema>;
export function defaultGlobalSettings(): GlobalSettings {
  return globalSettingsSchema.parse({
    version: 1, appearance: 'system', defaultEngine: 'hyperframes',
    claude: { auth: 'claude-code' }, elevenLabs: {}, voiceInput: 'whisper', whisperModel: 'base',
    remotionLicenseAcknowledgedAt: null, sandbox: { networkByDefault: false, allowedDomains: [] },
    snapshots: { retainDays: 30, maxBytes: 10 * 1024 ** 3 }, renderPreset: 'draft',
  });
}
