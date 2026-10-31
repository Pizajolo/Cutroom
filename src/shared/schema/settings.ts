import { z } from 'zod/v3';

// Credentials are Keychain references only; never persist tokens or API keys here.
export const globalSettingsSchema = z.object({
  version: z.literal(1), appearance: z.enum(['system', 'light', 'dark']),
  defaultEngine: z.enum(['hyperframes', 'remotion']),
  claude: z.object({ auth: z.enum(['subscription', 'api-key']), credentialRef: z.string().optional() }).strict(),
  elevenLabs: z.object({ apiKeyRef: z.string().optional(), oauthRef: z.string().optional() }).strict(),
  voiceInput: z.enum(['whisper', 'scribe']), whisperModel: z.enum(['base', 'small', 'medium', 'large-v3-turbo']),
  remotionLicenseAcknowledgedAt: z.string().datetime().nullable(),
  sandbox: z.object({ networkByDefault: z.literal(false), allowedDomains: z.array(z.string()) }).strict(),
  snapshots: z.object({ retainDays: z.number().int().positive(), maxBytes: z.number().int().positive() }).strict(),
  renderPreset: z.enum(['draft', 'final']),
}).strict();
export type GlobalSettings = z.infer<typeof globalSettingsSchema>;
