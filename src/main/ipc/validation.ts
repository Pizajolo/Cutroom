import type { z } from 'zod/v3';
import { IpcFailure, type IpcError, type IpcReply } from '@shared/ipc/contract';

export interface SenderContext { frameUrl: string; isMainFrame: boolean; destroyed: boolean }
export function isAppSender(sender: SenderContext, devUrl?: string): boolean {
  if (!sender.isMainFrame || sender.destroyed) return false;
  try {
    const url = new URL(sender.frameUrl);
    if (url.protocol === 'app:' && url.hostname === 'cutroom' && !url.port && !url.username && !url.password) return true;
    return devUrl !== undefined && url.origin === new URL(devUrl).origin;
  } catch { return false; }
}
export function serializeError(error: unknown): IpcError {
  if (error instanceof IpcFailure) return { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) };
  return { code: 'internal', message: 'An internal error occurred.' };
}
export function createRequestHandler<Req extends z.ZodTypeAny, Res extends z.ZodTypeAny>(
  schema: { req: Req; res: Res },
  impl: (request: z.output<Req>) => z.input<Res> | Promise<z.input<Res>>,
  options: { devUrl?: string; validateResponse: boolean },
): (sender: SenderContext, request: unknown) => Promise<z.output<Res>> {
  return async (sender, request) => {
    if (!isAppSender(sender, options.devUrl)) throw new IpcFailure({ code: 'forbidden', message: 'IPC sender is not the app top frame.' });
    const parsed = schema.req.safeParse(request);
    // Zod messages can quote input (including unknown property names). Never log the
    // request or return Zod's raw issues: credentials may be malformed objects too.
    if (!parsed.success) throw new IpcFailure({ code: 'invalid_request', message: 'Invalid request.', details: { issues: parsed.error.issues.map(({ path }) => ({ path: path.map((part) => typeof part === 'number' ? part : part === 'apiKey' ? 'apiKey' : '[field]'), message: 'Invalid request field.' })) } });
    const result: unknown = await impl(parsed.data);
    if (options.validateResponse) {
      const response = schema.res.safeParse(result);
      if (!response.success) throw new IpcFailure({ code: 'internal', message: 'Invalid handler response.' });
      return response.data;
    }
    return result as z.output<Res>;
  };
}
export async function reply<T>(action: () => Promise<T>): Promise<IpcReply<T>> {
  try { return { ok: true, data: await action() }; } catch (error) { return { ok: false, error: serializeError(error) }; }
}
export function validatedEmit<T extends z.ZodTypeAny>(schema: T, payload: unknown, send: (payload: z.output<T>) => void): boolean {
  const result = schema.safeParse(payload);
  if (!result.success) return false;
  send(result.data); return true;
}
