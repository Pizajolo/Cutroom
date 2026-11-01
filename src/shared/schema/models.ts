import { z } from 'zod/v3';
import { installStateSchema } from './media';

export const whisperModelNameSchema = z.enum(['base', 'small', 'medium', 'large-v3-turbo']);
export type WhisperModelName = z.infer<typeof whisperModelNameSchema>;
export const whisperModelInfoSchema = z.object({
  name: whisperModelNameSchema, sizeBytes: z.number().int().nonnegative(),
  status: z.enum(['installed', 'missing', 'checksum_mismatch']),
  install: installStateSchema.nullable(), isDefault: z.boolean(),
}).strict();
export type WhisperModelInfo = z.infer<typeof whisperModelInfoSchema>;
