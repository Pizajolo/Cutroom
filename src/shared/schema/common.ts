import { z } from 'zod/v3';
import { isProjectPath } from '../project/paths';

export const secondsSchema = z.number().finite().nonnegative();
export const positiveSchema = z.number().finite().positive();
export const projectPathSchema = z.string().min(1).refine(isProjectPath, 'Expected a literal project-relative path without traversal');

export const formatSchema = z.object({
  aspect: z.enum(['16:9', '9:16', '1:1', '4:5']),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.union([z.literal(23.976), z.literal(24), z.literal(25), z.literal(29.97), z.literal(30), z.literal(50), z.literal(60)]),
}).strict();
export type Format = z.infer<typeof formatSchema>;

const agentActorSchema = z.string().regex(/^agent:[A-Za-z0-9_-]+$/)
  .refine((value): value is `agent:${string}` => value.startsWith('agent:'));
export const actorSchema = z.union([z.literal('user'), z.literal('system'), agentActorSchema]);
