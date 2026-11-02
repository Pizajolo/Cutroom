import { z } from 'zod/v3';
import { formatSchema, positiveSchema, secondsSchema } from '../schema/common';
import { itemIdSchema, itemSchema, markerSchema, trackSchema, timelineDocSchema } from '../schema/timeline';

const trackId = z.string().min(1);
export const opSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('addItem'), trackId, item: itemSchema, index: z.number().int().nonnegative().optional() }).strict(),
  z.object({ type: z.literal('moveItem'), itemId: itemIdSchema, start: secondsSchema, trackId: trackId.optional() }).strict(),
  z.object({ type: z.literal('trimItem'), itemId: itemIdSchema, edge: z.enum(['start', 'end']), time: secondsSchema }).strict(),
  z.object({ type: z.literal('splitItem'), itemId: itemIdSchema, at: secondsSchema }).strict(),
  z.object({ type: z.literal('deleteItem'), itemId: itemIdSchema }).strict(),
  z.object({ type: z.literal('rippleDelete'), itemId: itemIdSchema }).strict(),
  z.object({ type: z.literal('insertGap'), trackId, at: secondsSchema, duration: positiveSchema }).strict(),
  z.object({ type: z.literal('reorderItem'), itemId: itemIdSchema, index: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('setProps'), itemId: itemIdSchema, patch: z.record(z.unknown()) }).strict(),
  z.object({ type: z.literal('setTrack'), trackId, muted: z.boolean().optional(), solo: z.boolean().optional(), name: z.string().optional() }).strict(),
  z.object({ type: z.literal('setFormat'), format: formatSchema.partial() }).strict(),
  z.object({ type: z.literal('addMarker'), marker: markerSchema }).strict(),
  z.object({ type: z.literal('updateMarker'), markerId: z.string(), patch: markerSchema.omit({ id: true }).partial() }).strict(),
  z.object({ type: z.literal('deleteMarker'), markerId: z.string() }).strict(),
]);
export type Op = z.infer<typeof opSchema>;

// These exact-value records are for persisted history only, never agent requests.
export const trackMetadataSchema = trackSchema.omit({ items: true });
export const historyOpSchema = z.union([
  opSchema,
  // Only project-wide history entries (e.g. snapshot restore), never normal edit inverses.
  z.object({ type: z.literal('restoreTimeline'), doc: timelineDocSchema }).strict(),
  z.object({ type: z.literal('restoreItem'), itemId: itemIdSchema, trackId, index: z.number().int().nonnegative(), item: itemSchema.nullable() }).strict()
    .refine((op) => op.item === null || op.item.id === op.itemId, 'Restored item id must match'),
  z.object({ type: z.literal('restoreTrack'), track: trackMetadataSchema }).strict(),
  z.object({ type: z.literal('restoreFormat'), format: formatSchema }).strict(),
  z.object({ type: z.literal('restoreMarker'), markerId: z.string().min(1), index: z.number().int().nonnegative(), marker: markerSchema.nullable() }).strict()
    .refine((op) => op.marker === null || op.marker.id === op.markerId, 'Restored marker id must match'),
]);
export type HistoryOp = z.infer<typeof historyOpSchema>;
