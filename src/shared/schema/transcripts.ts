import { z } from 'zod/v3';
import { projectPathSchema, secondsSchema } from './common';

export const transcriptionEngineSchema = z.enum(['whisper', 'scribe']);
export const transcriptSchema = z.object({
  rel: projectPathSchema, engine: transcriptionEngineSchema, model: z.string().min(1), language: z.string().min(1),
  words: z.array(z.object({ text: z.string(), start: secondsSchema, end: secondsSchema, confidence: z.number().min(0).max(1).optional() }).strict()
    .refine((word) => word.end >= word.start, 'Word end precedes start')),
  createdAt: z.string().datetime(),
}).strict();
export type Transcript = z.infer<typeof transcriptSchema>;
export const MAX_VOICE_AUDIO_BYTES = 10 * 1024 * 1024;
export const voiceTranscribeRequestSchema = z.object({
  audio: z.instanceof(Uint8Array).refine((audio) => audio.byteLength > 0 && audio.byteLength <= MAX_VOICE_AUDIO_BYTES, 'Audio must be between 1 byte and 10 MB'),
  mime: z.enum(['audio/webm', 'audio/wav']), engine: transcriptionEngineSchema,
}).strict();
