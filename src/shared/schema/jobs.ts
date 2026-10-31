import { z } from 'zod/v3';

export const jobInfoSchema = z.object({
  id: z.string().min(1), kind: z.string().min(1), label: z.string(),
  status: z.enum(['queued', 'running', 'done', 'failed', 'cancelled']),
  progress: z.number().finite().min(0).max(1), etaSec: z.number().finite().nonnegative().optional(),
  logPath: z.string(), result: z.unknown().optional(),
  error: z.object({ code: z.string(), message: z.string() }).strict().optional(),
}).strict();
export type JobInfo = z.infer<typeof jobInfoSchema>;
