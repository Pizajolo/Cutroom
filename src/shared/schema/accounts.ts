import { z } from 'zod/v3';

export const providerSchema = z.enum(['anthropic', 'openai', 'elevenlabs']);
export type Provider = z.infer<typeof providerSchema>;
export const accountStatusSchema = z.enum(['connected', 'not_connected', 'invalid', 'unreachable']);
export const accountMethodSchema = z.enum(['api-key', 'claude-code']);
export const keyPreviewSchema = z.string().regex(/^…\S{4}$/u);
export const accountInfoSchema = z.object({
  provider: providerSchema, status: accountStatusSchema,
  method: accountMethodSchema.nullable(), keyPreview: keyPreviewSchema.nullable(),
  detail: z.string().nullable(), checkedAt: z.string().datetime().nullable(),
}).strict();
export type AccountInfo = z.infer<typeof accountInfoSchema>;
export const claudeCodeStatusSchema = z.object({
  available: z.boolean(), loggedIn: z.boolean(),
  authMethod: z.enum(['none', 'claude.ai', 'oauth_token', 'api_key', 'api_key_helper', 'third_party', 'unknown']),
  email: z.string().nullable(), organization: z.string().nullable(), cliVersion: z.string().nullable(),
  binarySource: z.enum(['sdk-bundled', 'installed']).nullable(),
}).strict();
export type ClaudeCodeStatus = z.infer<typeof claudeCodeStatusSchema>;
