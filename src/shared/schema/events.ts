import { z } from 'zod/v3';
import { actorSchema } from './common';
import { projectDocSchema } from './project';
import { jobInfoSchema } from './jobs';
import { opSchema } from '../timeline/types';

const envelope = { seq: z.number().int().positive(), ts: z.string().datetime(), runId: z.string().optional(), actor: actorSchema };
export const eventEnvelopeSchema = z.discriminatedUnion('type', [
  z.object({ ...envelope, type: z.literal('project.created'), payload: projectDocSchema }).strict(),
  z.object({ ...envelope, type: z.literal('project.opened'), payload: z.object({ projectId: z.string() }).strict() }).strict(),
  z.object({ ...envelope, type: z.literal('project.updated'), payload: projectDocSchema }).strict(),
  z.object({ ...envelope, type: z.literal('timeline.op'), payload: z.object({ ops: z.array(opSchema).min(1), editId: z.string() }).strict() }).strict(),
  z.object({ ...envelope, type: z.literal('job.queued'), payload: jobInfoSchema }).strict(),
  z.object({ ...envelope, type: z.literal('job.updated'), payload: jobInfoSchema }).strict(),
  z.object({ ...envelope, type: z.literal('job.finished'), payload: jobInfoSchema }).strict(),
]);
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;
