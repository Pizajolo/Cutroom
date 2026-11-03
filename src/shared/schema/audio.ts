import { z } from 'zod/v3';
import { positiveSchema, projectPathSchema, secondsSchema } from './common';

export const audioKindSchema = z.enum(['tts', 'sfx', 'music', 'isolate']);
const text = z.string().trim().min(1).max(50_000);
export const audioPlacementSchema = z.object({ time: secondsSchema, track: z.enum(['voiceover', 'music', 'sfx']) }).strict();
const placement = audioPlacementSchema.optional();
export const audioGenerateRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('tts'), text, voiceId: z.string().min(1), model: z.string().min(1).optional(), placement }).strict(),
  z.object({ kind: z.literal('sfx'), text, durationSec: positiveSchema.max(600).optional(), placement }).strict(),
  z.object({ kind: z.literal('music'), text, durationSec: positiveSchema.max(600), placement }).strict(),
  z.object({ kind: z.literal('isolate'), rel: projectPathSchema, placement }).strict(),
]);
export type AudioGenerateRequest = z.infer<typeof audioGenerateRequestSchema>;
export const audioVoiceSchema = z.object({ id: z.string().min(1), name: z.string(), previewUrl: z.string().url().nullable(), labels: z.record(z.string()) }).strict();
export type AudioVoice = z.infer<typeof audioVoiceSchema>;
