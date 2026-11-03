import { z } from 'zod/v3';
import { positiveSchema, secondsSchema } from './common';
import { itemIdSchema } from './timeline';

export const timeRangeSchema = z.object({ start: secondsSchema, end: positiveSchema }).strict()
  .refine((range) => range.end > range.start, 'Range end must be after start');
export type TimeRange = z.infer<typeof timeRangeSchema>;
export const exportPresetSchema = z.object({
  id: z.string().min(1), name: z.string().trim().min(1).max(120), builtin: z.boolean(),
  container: z.enum(['mp4', 'mov']), vcodec: z.enum(['h264', 'hevc', 'prores']),
  crf: z.number().int().min(0).max(51).optional(), bitrateKbps: z.number().int().positive().optional(),
  size: z.union([z.literal('project'), z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).strict()]),
  fit: z.enum(['fit', 'fill']), fps: z.union([z.literal('project'), positiveSchema.max(240)]),
  audio: z.object({ codec: z.enum(['aac', 'pcm_s16le', 'pcm_s24le']), loudnessLufs: z.literal(-14), truePeakDb: z.literal(-1) }).strict(),
}).strict().refine((preset) => (preset.crf === undefined) !== (preset.bitrateKbps === undefined), 'Specify either CRF or bitrate, not both');
export type ExportPreset = z.infer<typeof exportPresetSchema>;
export const exportPreflightSchema = z.object({
  canExport: z.boolean(), blockers: z.array(z.string()),
  unsupportedItems: z.array(z.object({ itemId: itemIdSchema, type: z.string(), name: z.string() }).strict()),
  outputLabel: z.string(),
}).strict();
export type ExportPreflight = z.infer<typeof exportPreflightSchema>;
