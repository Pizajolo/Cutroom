import { z } from 'zod/v3';
import { projectPathSchema } from '../schema/common';
import { toolInfoSchema, mediaFileSchema, thumbnailSchema, waveformSchema, importDestinationSchema } from '../schema/media';

export const ipcErrorSchema = z.object({
  code: z.enum(['invalid_request', 'not_found', 'forbidden', 'conflict', 'user_edited', 'internal']),
  message: z.string(), details: z.record(z.unknown()).optional(),
}).strict();
export type IpcError = z.infer<typeof ipcErrorSchema>;
export { IpcFailure } from './errors';
export const contract = {
  invoke: {
    'app.getInfo': {
      req: z.object({}).strict(),
      res: z.object({
        version: z.string(), platform: z.string(), arch: z.string(), homeDir: z.string(),
        mediaBaseUrl: z.string().url().nullable(), compBaseUrl: z.string().url().nullable(),
      }).strict(),
    },
    'app.ping': { req: z.object({}).strict(), res: z.object({ pong: z.literal(true) }).strict() },
    'tools.list': { req: z.object({}).strict(), res: z.array(toolInfoSchema) },
    'media.selectProjectFolder': { req: z.object({}).strict(), res: z.object({ id: z.string(), root: z.string() }).strict().nullable() },
    'media.list': { req: z.object({}).strict(), res: z.array(mediaFileSchema) },
    'media.cancel': { req: z.object({}).strict(), res: z.object({ ok: z.literal(true) }).strict() },
    'media.importPaths': { req: z.object({ paths: z.array(z.string().min(1)).min(1).max(100), destination: importDestinationSchema }).strict(), res: z.array(mediaFileSchema) },
    'media.importDialog': { req: z.object({ destination: importDestinationSchema }).strict(), res: z.array(mediaFileSchema) },
    'media.thumbnails': { req: z.object({ rel: projectPathSchema }).strict(), res: thumbnailSchema },
    'media.waveform': { req: z.object({ rel: projectPathSchema }).strict(), res: waveformSchema },
    'shell.revealInProject': { req: z.object({ rel: projectPathSchema }).strict(), res: z.object({ ok: z.literal(true) }).strict() },
  },
  events: {
    'app.ready': z.object({ version: z.string() }).strict(),
    'tools.changed': z.array(toolInfoSchema),
    'media.changed': z.object({ projectId: z.string(), rels: z.array(projectPathSchema) }).strict(),
    'media.progress': z.object({ projectId: z.string(), rel: projectPathSchema, stage: z.enum(['probe', 'thumbnails', 'waveform', 'import']), progress: z.number().finite().min(0).max(1) }).strict(),
  },
} as const;
export type InvokeChannel = keyof typeof contract.invoke;
export type EventName = keyof typeof contract.events;
export type InvokeReq<C extends InvokeChannel> = z.input<(typeof contract.invoke)[C]['req']>;
export type InvokeRes<C extends InvokeChannel> = z.output<(typeof contract.invoke)[C]['res']>;
export type EventPayload<E extends EventName> = z.output<(typeof contract.events)[E]>;
export type IpcReply<T> = { ok: true; data: T } | { ok: false; error: IpcError };
