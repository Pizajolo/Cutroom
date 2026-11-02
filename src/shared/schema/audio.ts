import { z } from 'zod/v3';
import { positiveSchema, projectPathSchema } from './common';

export const audioKindSchema = z.enum(['tts', 'sfx', 'music', 'isolate']);
const text = z.string().trim().min(1).max(50_000);
export const audioGenerateRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('tts'), text, voiceId: z.string().min(1), model: z.string().min(1).optional() }).strict(),
  z.object({ kind: z.literal('sfx'), text, durationSec: positiveSchema.max(600).optional() }).strict(),
  z.object({ kind: z.literal('music'), text, durationSec: positiveSchema.max(600) }).strict(),
  z.object({ kind: z.literal('isolate'), rel: projectPathSchema }).strict(),
]);
export type AudioGenerateRequest = z.infer<typeof audioGenerateRequestSchema>;
export const audioVoiceSchema = z.object({ id: z.string().min(1), name: z.string(), previewUrl: z.string().url().nullable(), labels: z.record(z.string()) }).strict();
export type AudioVoice = z.infer<typeof audioVoiceSchema>;
