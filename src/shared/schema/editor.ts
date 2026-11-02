import { z } from 'zod/v3';
import { actorSchema, projectPathSchema } from './common';
import { timelineDocSchema } from './timeline';

export const timelineStateSchema = z.object({
  doc: timelineDocSchema, revision: z.number().int().nonnegative(), canUndo: z.boolean(), canRedo: z.boolean(),
}).strict();
export type TimelineState = z.infer<typeof timelineStateSchema>;
export const timelineChangedSchema = z.object({
  revision: z.number().int().nonnegative(), doc: timelineDocSchema, actor: actorSchema, label: z.string(), requestId: z.string().min(1).optional(),
}).strict();
export const historyEntrySchema = z.object({
  id: z.string().min(1), label: z.string(), actor: actorSchema, createdAt: z.string().datetime(), revision: z.number().int().nonnegative(),
}).strict();
export type HistoryEntry = z.infer<typeof historyEntrySchema>;
export const storageCategorySchema = z.enum(['thumbnails', 'waveforms', 'renders', 'transcripts', 'snapshots']);
export const storageItemSchema = z.object({ rel: projectPathSchema, bytes: z.number().int().nonnegative(), category: storageCategorySchema }).strict();
export const storageUsageSchema = z.object({
  totalBytes: z.number().int().nonnegative(), categories: z.array(z.object({ category: storageCategorySchema, bytes: z.number().int().nonnegative(), items: z.number().int().nonnegative() }).strict()),
}).strict();
export const cleanPreviewSchema = z.object({ token: z.string().min(1), bytes: z.number().int().nonnegative(), items: z.array(storageItemSchema) }).strict();
export const snapshotInfoSchema = z.object({
  id: z.string().min(1), label: z.string(), createdAt: z.string().datetime(), bytes: z.number().int().nonnegative(), revision: z.number().int().nonnegative(),
}).strict();
export type SnapshotInfo = z.infer<typeof snapshotInfoSchema>;
