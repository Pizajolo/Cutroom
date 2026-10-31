import { contract, ipcErrorSchema, IpcFailure, type EventName, type EventPayload, type InvokeChannel, type InvokeRes, type IpcReply } from '@shared/ipc/contract';
import type { CutroomBridge } from '@shared/ipc/bridge';

export interface BridgeTransport {
  invoke(channel: string, request: unknown): Promise<unknown>;
  subscribe(channel: string, callback: (payload: unknown) => void): () => void;
  getPathForFile(file: File): string;
}
export function createBridge(transport: BridgeTransport, allowed: { invoke: readonly string[]; events: readonly string[] }): CutroomBridge {
  const invokeChannels = new Set(allowed.invoke); const eventChannels = new Set(allowed.events);
  const bridge: CutroomBridge = {
    async invoke<C extends InvokeChannel>(channel: C, req: Parameters<CutroomBridge['invoke']>[1]): Promise<IpcReply<InvokeRes<C>>> {
      if (!invokeChannels.has(channel) || !Object.hasOwn(contract.invoke, channel)) throw new IpcFailure({ code: 'forbidden', message: 'Unknown IPC channel.' });
      const invalid: IpcReply<never> = { ok: false, error: { code: 'internal', message: 'Invalid IPC response.' } };
      let result: unknown;
      try { result = await transport.invoke(channel, req); }
      catch { return { ok: false, error: { code: 'internal', message: 'The app connection is unavailable.' } }; }
      if (typeof result !== 'object' || result === null || !('ok' in result)) return invalid;
      if (result.ok === false && 'error' in result) {
        const error = ipcErrorSchema.safeParse(result.error);
        return error.success ? { ok: false, error: error.data } : invalid;
      }
      if (result.ok !== true || !('data' in result)) return invalid;
      const parsed = contract.invoke[channel].res.safeParse(result.data);
      if (!parsed.success) return invalid;
      return { ok: true, data: parsed.data as InvokeRes<C> };
    },
    on<E extends EventName>(event: E, cb: (payload: EventPayload<E>) => void): () => void {
      if (!eventChannels.has(event) || !Object.hasOwn(contract.events, event)) throw new IpcFailure({ code: 'forbidden', message: 'Unknown IPC event.' });
      return transport.subscribe(event, (payload) => {
        const parsed = contract.events[event].safeParse(payload);
        if (parsed.success) cb(parsed.data as EventPayload<E>);
      });
    },
    getPathForFile(file) { return transport.getPathForFile(file); },
  };
  return Object.freeze(bridge);
}
