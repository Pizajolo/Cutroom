import type { CutroomBridge } from '@shared/ipc/bridge';
import { IpcFailure, type EventName, type EventPayload, type InvokeChannel, type InvokeReq, type InvokeRes } from '@shared/ipc';

export function createApi(getBridge: () => CutroomBridge | undefined) {
  const bridge = (): CutroomBridge => {
    const value = getBridge();
    if (!value) throw new IpcFailure({ code: 'internal', message: 'The desktop connection is unavailable. Open Cutroom from the desktop app.' });
    return value;
  };
  return {
    async invoke<C extends InvokeChannel>(channel: C, request: InvokeReq<C>): Promise<InvokeRes<C>> {
      const reply = await bridge().invoke(channel, request);
      if (!reply.ok) throw new IpcFailure(reply.error);
      return reply.data;
    },
    on<E extends EventName>(event: E, callback: (payload: EventPayload<E>) => void): () => void {
      return bridge().on(event, callback);
    },
    getPathForFile(file: File): string {
      return bridge().getPathForFile(file);
    },
  };
}

export const api = createApi(() => window.cutroom);
export type Api = ReturnType<typeof createApi>;
