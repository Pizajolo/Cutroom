import { z } from 'zod/v3';

export const ipcErrorSchema = z.object({
  code: z.enum(['invalid_request', 'not_found', 'forbidden', 'conflict', 'user_edited', 'internal']),
  message: z.string(), details: z.record(z.unknown()).optional(),
}).strict();
export type IpcError = z.infer<typeof ipcErrorSchema>;
export class IpcFailure extends Error implements IpcError {
  readonly code: IpcError['code'];
  readonly details?: IpcError['details'];
  constructor(error: IpcError) { super(error.message); this.name = 'IpcFailure'; this.code = error.code; this.details = error.details; }
}
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
  },
  events: { 'app.ready': z.object({ version: z.string() }).strict() },
} as const;
export type InvokeChannel = keyof typeof contract.invoke;
export type EventName = keyof typeof contract.events;
export type InvokeReq<C extends InvokeChannel> = z.input<(typeof contract.invoke)[C]['req']>;
export type InvokeRes<C extends InvokeChannel> = z.output<(typeof contract.invoke)[C]['res']>;
export type EventPayload<E extends EventName> = z.output<(typeof contract.events)[E]>;
export type IpcReply<T> = { ok: true; data: T } | { ok: false; error: IpcError };
