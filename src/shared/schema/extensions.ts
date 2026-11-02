import { z } from 'zod/v3';

export const extensionIdSchema = z.string().min(1).max(100).regex(/^[a-z][a-z0-9-]*$/);
export const BUILTIN_EXTENSION_IDS = ['cutroom', 'elevenlabs', 'codex', 'elevenlabs-hosted'] as const;
const metadata = { id: extensionIdSchema, name: z.string().trim().min(1).max(120), enabled: z.boolean() };
const httpUrl = z.string().url().refine((value) => {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}, 'Expected an HTTP(S) URL without credentials');
export const extensionConfigSchema = z.discriminatedUnion('transport', [
  z.object({ ...metadata, transport: z.literal('stdio'), command: z.string().min(1).max(4096), args: z.array(z.string().max(4096)).max(100) }).strict(),
  z.object({ ...metadata, transport: z.literal('http'), url: httpUrl }).strict(),
]);
export type ExtensionConfig = z.infer<typeof extensionConfigSchema>;
export const secretEnvNameSchema = z.string().regex(/^[A-Z_][A-Z0-9_]*$/).max(100);
// Raw secrets are accepted only by extensions.add, then written to Keychain.
export const storedExtensionSchema = z.object({
  config: extensionConfigSchema, secretEnvRefs: z.record(secretEnvNameSchema, z.string().min(1).max(512)),
}).strict();
export const extensionInfoSchema = z.object({
  config: extensionConfigSchema, builtin: z.boolean(), secretEnvNames: z.array(secretEnvNameSchema),
  status: z.enum(['disabled', 'ready', 'unavailable', 'error']), detail: z.string().nullable(),
}).strict();
export type ExtensionInfo = z.infer<typeof extensionInfoSchema>;
export const extensionValidationSchema = z.object({ commandPreview: z.string(), domains: z.array(z.string()), scopes: z.array(z.string()) }).strict();
