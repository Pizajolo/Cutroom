import type { EventName, EventPayload, InvokeChannel, InvokeReq, InvokeRes, IpcReply } from './contract';

export interface CutroomBridge {
  // Resolve envelopes across contextBridge: Error custom fields do not survive it.
  invoke<C extends InvokeChannel>(channel: C, req: InvokeReq<C>): Promise<IpcReply<InvokeRes<C>>>;
  on<E extends EventName>(event: E, cb: (payload: EventPayload<E>) => void): () => void;
  getPathForFile(file: File): string;
}

declare global { interface Window { cutroom: CutroomBridge } }
