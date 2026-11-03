import { commandSchema, readySchema, responseSchema, type CommandInput } from '../../compositions/bridge/protocol';
interface Pending { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
export class CompositionBridge {
  private port: MessagePort | null = null;
  private nonce = '';
  private pending = new Map<string, Pending>();
  private awaitingLoad = true;
  private disposed = false;
  private serial = 0;
  private readyWaiters = new Map<() => void, (error: Error) => void>();
  constructor(private iframe: HTMLIFrameElement, private url: string, private timeout = 5000, private onReady?: () => void) {
    window.addEventListener('message', this.ready);
    iframe.addEventListener('load', this.loaded);
    this.navigate();
  }
  private navigate() {
    this.nonce = crypto.randomUUID();
    const url = new URL(this.url);
    url.hash = new URLSearchParams({ n: this.nonce }).toString();
    url.searchParams.set('cutroomLoad', this.nonce);
    this.awaitingLoad = true;
    this.iframe.src = url.href;
  }
  private loaded = () => {
    this.disconnect('Composition reloaded.');
    if (this.awaitingLoad) this.awaitingLoad = false;
    else this.navigate();
  };
  private ready = (event: MessageEvent) => {
    if (this.disposed || this.port || event.source !== this.iframe.contentWindow || event.origin !== 'null') return;
    const data = readySchema.safeParse(event.data);
    if (!data.success || data.data.nonce !== this.nonce) return;
    const channel = new MessageChannel();
    this.port = channel.port1;
    this.port.onmessage = (reply) => {
      const parsed = responseSchema.safeParse(reply.data);
      if (!parsed.success) return;
      const request = this.pending.get(parsed.data.id);
      if (!request) return;
      clearTimeout(request.timer); this.pending.delete(parsed.data.id);
      if (parsed.data.ok) request.resolve(parsed.data.result); else request.reject(new Error(parsed.data.error ?? 'Composition command failed.'));
    };
    this.port.start();
    // The only wildcard message contains no project data, props, text or media URL.
    this.iframe.contentWindow!.postMessage({ type: 'cutroom-bridge-init', nonce: this.nonce }, '*', [channel.port2]);
    this.readyWaiters.forEach((_reject, notify) => notify()); this.readyWaiters.clear();
    this.onReady?.();
  };
  async request(command: CommandInput): Promise<unknown> {
    if (this.disposed) throw new Error('Composition preview closed.');
    if (!this.port) await new Promise<void>((resolve, reject) => {
      const done = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => { this.readyWaiters.delete(done); reject(new Error('Composition preview did not become ready.')); }, this.timeout);
      this.readyWaiters.set(done, (error) => { clearTimeout(timer); reject(error); });
    });
    if (!this.port || this.disposed) throw new Error('Composition preview is unavailable.');
    const id = String(++this.serial);
    const payload = commandSchema.parse({ ...command, version: 1, id });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Composition preview timed out.')); }, this.timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.port!.postMessage(payload);
    });
  }
  private disconnect(message: string) {
    this.port?.close(); this.port = null;
    for (const value of this.pending.values()) { clearTimeout(value.timer); value.reject(new Error(message)); }
    this.pending.clear();
  }
  dispose() {
    this.disposed = true; window.removeEventListener('message', this.ready); this.iframe.removeEventListener('load', this.loaded); this.disconnect('Composition preview closed.');
    this.readyWaiters.forEach((reject) => reject(new Error('Composition preview closed.'))); this.readyWaiters.clear();
  }
}
