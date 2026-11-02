import { z } from 'zod/v3';

export const jobInfoSchema = z.object({
  id: z.string().min(1), kind: z.enum(['export', 'transcribe', 'url_import', 'composition_render', 'audio_generate']), label: z.string(),
  projectId: z.string().min(1), phase: z.string(), createdAt: z.string().datetime(), finishedAt: z.string().datetime().nullable(),
  status: z.enum(['queued', 'running', 'done', 'failed', 'cancelled']),
  progress: z.number().finite().min(0).max(1), etaSec: z.number().finite().nonnegative().optional(),
  logPath: z.string(), result: z.unknown().optional(),
  error: z.object({ code: z.string(), message: z.string() }).strict().optional(),
}).strict();
export type JobInfo = z.infer<typeof jobInfoSchema>;
