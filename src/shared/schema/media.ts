import { z } from 'zod/v3';
import { projectPathSchema } from './common';

export const toolInfoSchema = z.object({
  name: z.string(), version: z.string(), path: z.string(),
  source: z.enum(['bundled', 'updated']), status: z.enum(['ok', 'missing', 'checksum_mismatch']),
}).strict();
export type ToolInfo = z.infer<typeof toolInfoSchema>;
export const mediaProbeSchema = z.object({
  duration: z.number().finite().nonnegative(), width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(), fps: z.number().finite().positive().nullable(),
  vcodec: z.string().nullable(), acodec: z.string().nullable(), channels: z.number().int().positive().nullable(),
  sampleRate: z.number().int().positive().nullable(), bitrate: z.number().finite().nonnegative().nullable(),
  size: z.number().int().nonnegative(), hasAlpha: z.boolean(),
}).strict();
export type MediaProbe = z.infer<typeof mediaProbeSchema>;
export const mediaFileSchema = z.object({
  rel: projectPathSchema, name: z.string(), kind: z.enum(['video', 'audio', 'image', 'other']),
  url: z.string().url(), probe: mediaProbeSchema.nullable(),
  error: z.object({ code: z.string(), message: z.string() }).strict().optional(),
}).strict();
export type MediaFile = z.infer<typeof mediaFileSchema>;
export const thumbnailSchema = z.object({
  imageRel: projectPathSchema, imageUrl: z.string().url(), interval: z.number().positive(),
  frameWidth: z.number().int().positive(), frameHeight: z.number().int().positive(),
  columns: z.number().int().positive(), rows: z.number().int().positive(), count: z.number().int().positive(),
  frames: z.array(z.object({ time: z.number().nonnegative(), x: z.number().int().nonnegative(), y: z.number().int().nonnegative(), w: z.number().int().positive(), h: z.number().int().positive() }).strict()),
}).strict();
export type Thumbnails = z.infer<typeof thumbnailSchema>;
export const waveformSchema = z.object({
  rel: projectPathSchema, duration: z.number().nonnegative(), sampleRate: z.literal(8000), samplesPerPeak: z.literal(256),
  peaks: z.array(z.object({ min: z.number().min(-1).max(1), max: z.number().min(-1).max(1) }).strict()),
}).strict();
export type Waveform = z.infer<typeof waveformSchema>;
export const importDestinationSchema = z.enum(['raw', 'references', 'assets']);
export type ImportDestination = z.infer<typeof importDestinationSchema>;
