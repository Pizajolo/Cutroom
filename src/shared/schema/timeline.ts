import { z } from 'zod/v3';
import { actorSchema, formatSchema, positiveSchema, projectPathSchema, secondsSchema } from './common';

export const TRACK_KINDS = ['overlay', 'text', 'captions', 'video', 'broll', 'voiceover', 'music', 'sfx'] as const;
export const COMPOSITING_ORDER = ['overlay', 'text', 'captions', 'broll', 'video'] as const;
export const NO_OVERLAP_TRACKS = ['video', 'voiceover'] as const;
export { PROJECT_DIRS, READ_ONLY_DIRS } from '../project/constants';
export const itemIdSchema = z.string().regex(/^(clip|composition|text|caption|audio)_[A-Za-z0-9_-]{10}$/);
const idFor = (type: string) => z.string().regex(new RegExp(`^${type}_[A-Za-z0-9_-]{10}$`));
const base = {
  start: secondsSchema,
  duration: positiveSchema,
  note: z.string().optional(),
  createdBy: actorSchema,
  userEdited: z.array(z.string()),
};

export const textStyleSchema = z.object({
  fontFamily: z.string(), fontSize: positiveSchema, fontWeight: z.number().int().min(100).max(1000),
  color: z.string(), align: z.enum(['left', 'center', 'right']),
  opacity: z.number().min(0).max(1).optional(), letterSpacing: z.number().finite().optional(),
  lineHeight: positiveSchema.optional(),
}).strict();
export const layoutSchema = z.object({
  x: z.number().finite(), y: z.number().finite(), w: positiveSchema, h: positiveSchema,
  rotation: z.number().finite(), anchor: z.enum(['center', 'top-left', 'top', 'top-right', 'left', 'right', 'bottom-left', 'bottom', 'bottom-right']),
}).strict();

const clipSchema = z.object({
  ...base, type: z.literal('clip'), id: idFor('clip'), src: projectPathSchema,
  in: secondsSchema, out: positiveSchema, speed: positiveSchema, volume: z.number().finite().nonnegative(), muted: z.boolean(),
  crop: z.object({ x: secondsSchema, y: secondsSchema, w: positiveSchema, h: positiveSchema }).strict().optional(),
  reframe: z.object({ mode: z.enum(['fit', 'fill', 'manual', 'track']), x: z.number().finite(), y: z.number().finite(), scale: positiveSchema }).strict().optional(),
  color: z.object({ exposure: z.number().finite(), contrast: z.number().finite(), saturation: z.number().finite(), temperature: z.number().finite(), lut: projectPathSchema.optional() }).strict().optional(),
  behindSubject: z.boolean().optional(),
}).strict();
const compositionSchema = z.object({
  ...base, type: z.literal('composition'), id: idFor('composition'),
  engine: z.enum(['hyperframes', 'remotion']), path: projectPathSchema, compositionId: z.string().optional(),
  props: z.record(z.record(z.unknown())), behindSubject: z.boolean().optional(),
}).strict();
const textSchema = z.object({
  ...base, type: z.literal('text'), id: idFor('text'), text: z.string(),
  style: textStyleSchema, layout: layoutSchema,
  animation: z.object({ in: z.string(), out: z.string(), inDuration: secondsSchema, outDuration: secondsSchema, easing: z.string() }).strict(),
  behindSubject: z.boolean().optional(),
}).strict();
const captionSchema = z.object({
  ...base, type: z.literal('caption'), id: idFor('caption'), sourceItemId: itemIdSchema.optional(),
  words: z.array(z.object({ id: z.string().min(1), text: z.string(), start: secondsSchema, end: secondsSchema, confidence: z.number().min(0).max(1).optional() }).strict()),
  stylePreset: z.string(), highlight: z.string().nullable(),
}).strict();
const audioSchema = z.object({
  ...base, type: z.literal('audio'), id: idFor('audio'), src: projectPathSchema,
  in: secondsSchema, out: positiveSchema, gain: z.number().finite(), fadeIn: secondsSchema, fadeOut: secondsSchema,
  ducking: z.object({ enabled: z.boolean(), amount: z.number().finite().nonpositive(), attack: secondsSchema, release: secondsSchema }).strict().optional(),
  generated: z.object({ provider: z.string(), sidecar: projectPathSchema }).strict().optional(),
}).strict();

export const itemSchema = z.discriminatedUnion('type', [clipSchema, compositionSchema, textSchema, captionSchema, audioSchema]);
export type TimelineItem = z.infer<typeof itemSchema>;
export const trackSchema = z.object({
  id: z.string().min(1), kind: z.enum(TRACK_KINDS), name: z.string(), muted: z.boolean(), solo: z.boolean(), items: z.array(itemSchema),
}).strict();
export type Track = z.infer<typeof trackSchema>;
export const markerSchema = z.object({
  id: z.string().min(1), time: secondsSchema, endTime: secondsSchema.optional(), label: z.string(), kind: z.enum(['marker', 'feedback']),
}).strict();
export type Marker = z.infer<typeof markerSchema>;

export const timelineDocSchema = z.object({
  version: z.literal(1), format: formatSchema, tracks: z.array(trackSchema).length(8), markers: z.array(markerSchema),
}).strict().superRefine((doc, ctx) => {
  const ids = new Set<string>();
  doc.tracks.forEach((track, index) => {
    if (track.kind !== TRACK_KINDS[index]) ctx.addIssue({ code: 'custom', path: ['tracks', index, 'kind'], message: 'Incorrect track order' });
    if (ids.has(track.id)) ctx.addIssue({ code: 'custom', message: 'Duplicate track id' });
    ids.add(track.id);
    for (const item of track.items) {
      if (ids.has(item.id)) ctx.addIssue({ code: 'custom', message: 'Duplicate item id' });
      ids.add(item.id);
      if ((item.type === 'clip' || item.type === 'audio') && item.out <= item.in) ctx.addIssue({ code: 'custom', message: 'Source out must be after in' });
      if (item.type === 'caption' && item.words.some((word) => word.end < word.start)) ctx.addIssue({ code: 'custom', message: 'Caption word end precedes start' });
    }
  });
  const markerIds = new Set<string>();
  for (const marker of doc.markers) {
    if (markerIds.has(marker.id)) ctx.addIssue({ code: 'custom', message: 'Duplicate marker id' });
    markerIds.add(marker.id);
    if (marker.endTime !== undefined && marker.endTime < marker.time) ctx.addIssue({ code: 'custom', message: 'Marker end precedes start' });
  }
});
export type TimelineDoc = z.infer<typeof timelineDocSchema>;
export const TimelineDocSchema = timelineDocSchema;
