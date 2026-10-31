import { z } from 'zod/v3';
import { formatSchema, projectPathSchema } from './common';

export const projectDocSchema = z.object({
  id: z.string().min(1), name: z.string().min(1),
  folderMap: z.object({
    raw: projectPathSchema, references: projectPathSchema, assets: projectPathSchema,
    compositions: projectPathSchema, audio: projectPathSchema, work: projectPathSchema, final: projectPathSchema,
  }).strict(),
  defaultEngine: z.enum(['hyperframes', 'remotion']), format: formatSchema, createdAt: z.string().datetime(),
}).strict();
export type ProjectDoc = z.infer<typeof projectDocSchema>;
export const ProjectDocSchema = projectDocSchema;
