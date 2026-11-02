import { z } from 'zod/v3';
import { positiveSchema, projectPathSchema } from './common';

export const compositionNameSchema = z.string().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
export const compositionEngineSchema = z.enum(['hyperframes', 'remotion']);
export const compositionTemplateSchema = z.object({
  id: z.string().min(1), name: z.string(), engine: compositionEngineSchema, description: z.string(),
}).strict();
export const compositionInfoSchema = z.object({
  name: compositionNameSchema, engine: compositionEngineSchema, path: projectPathSchema, durationSec: positiveSchema,
  compositionId: z.string().optional(),
}).strict();
export type CompositionInfo = z.infer<typeof compositionInfoSchema>;
export const compositionCheckSchema = z.object({
  ok: z.boolean(), violations: z.array(z.object({ code: z.string(), message: z.string(), rel: projectPathSchema.optional() }).strict()),
}).strict();
