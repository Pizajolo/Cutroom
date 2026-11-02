import { z } from 'zod/v3';
import { positiveSchema, secondsSchema } from './common';

export const importUrlSchema = z.string().url().max(4096).refine((value) => {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}, 'Expected an HTTP(S) URL without credentials');
export const urlFormatSchema = z.object({
  id: z.string().min(1), label: z.string(), ext: z.string().min(1), width: z.number().int().positive().optional(), height: z.number().int().positive().optional(),
  fps: positiveSchema.optional(), vcodec: z.string().optional(), acodec: z.string().optional(), approxBytes: z.number().int().nonnegative().optional(),
}).strict();
export const urlMetadataSchema = z.object({
  title: z.string(), uploader: z.string(), durationSec: secondsSchema, thumbnailUrl: importUrlSchema.nullable(), formats: z.array(urlFormatSchema),
}).strict();
export type UrlMetadata = z.infer<typeof urlMetadataSchema>;
