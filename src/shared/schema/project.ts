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

export const projectNameSchema = z.string().trim().min(1).max(120)
  .refine((name) => !name.includes('/') && !name.includes('\\') && ![...name].some((char) => char.charCodeAt(0) < 32) && name !== '.' && name !== '..', 'Expected a project name, not a path');
// Opaque, main-owned, one-use capabilities expire after ten minutes. displayPath is never authority.
export const FOLDER_GRANT_TTL_MS = 10 * 60_000;
export const folderGrantIdSchema = z.string().min(1).max(200);
export const folderGrantSchema = z.object({ grantId: folderGrantIdSchema, displayPath: z.string().min(1) }).strict();
export const projectSessionSchema = z.object({ project: projectDocSchema, rootPath: z.string().min(1), looseMediaCount: z.number().int().nonnegative() }).strict();
export type ProjectSession = z.infer<typeof projectSessionSchema>;
export const recentProjectSchema = z.object({
  id: z.string().min(1), name: z.string().min(1), rootPath: z.string().min(1), format: formatSchema,
  lastOpenedAt: z.string().datetime(), missing: z.boolean(),
}).strict();
export type RecentProject = z.infer<typeof recentProjectSchema>;
export const projectOpenResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('opened'), session: projectSessionSchema }).strict(),
  z.object({ status: z.literal('needsCreate'), grantId: folderGrantIdSchema, displayPath: z.string().min(1), looseMediaCount: z.number().int().nonnegative() }).strict(),
]);
