import { propsDocSchema, type PropsDoc } from '../../shared/schema/props';
import { applyProps } from '../../shared/props/applyProps';
import { commandSchema, initSchema, type BridgeCommand } from './protocol';
interface Seekable { seek(time: number, suppressEvents?: boolean): unknown; play(): unknown; pause(): unknown }
declare global {
  interface Window {
    __CUTROOM_APP_ORIGIN__?: string;
    __timelines?: Record<string, Seekable>;
    __cutroomSeek?: (time: number) => void;
    __cutroomProps?: (values: Record<string, Record<string, unknown>>) => void;
  }
}
export function installHost(window: Window, allowedOrigin: string): () => void {
  if (allowedOrigin !== 'app://cutroom' && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(allowedOrigin)) throw new Error('Invalid app origin');
  const nonce = new URLSearchParams(window.location.hash.slice(1)).get('n');
  if (!nonce || nonce.length < 16) return () => {};
  let port: MessagePort | null = null;
  let accepted = false;
  let schema: PropsDoc | null = null;
  const getSchema = async () => {
    if (!schema) {
      const response = await window.fetch(new URL('props.json', window.location.href));
      if (!response.ok) throw new Error('Editable props could not be loaded');
      schema = propsDocSchema.parse(await response.json());
    }
    return schema;
  };
  const execute = async (command: BridgeCommand): Promise<unknown> => {
    const timelines = Object.values(window.__timelines ?? {});
    if (command.command === 'load' || command.command === 'setProps') {
      if (command.schema) schema = command.schema;
      if (command.props) { applyProps(window.document, await getSchema(), command.props); window.__cutroomProps?.(command.props); }
      return { loaded: true };
    }
    if (command.command === 'seek') { timelines.forEach((t) => t.seek(command.time, false)); window.__cutroomSeek?.(command.time); return { time: command.time }; }
    if (command.command === 'play') { timelines.forEach((t) => t.play()); return {}; }
    if (command.command === 'pause') { timelines.forEach((t) => t.pause()); return {}; }
    if (command.command === 'hitTest') { const hit = window.document.elementFromPoint(command.x, command.y)?.closest('[data-cut-id]'); return { cutId: hit?.getAttribute('data-cut-id') ?? null }; }
    return { elements: [...window.document.querySelectorAll<HTMLElement>('[data-cut-id]')].map((node) => { const r = node.getBoundingClientRect(); return { id: node.dataset.cutId, text: node.textContent?.slice(0, 10000), x: r.x, y: r.y, width: r.width, height: r.height }; }) };
  };
  const init = (event: MessageEvent) => {
    if (accepted || event.source !== window.parent || event.origin !== allowedOrigin || event.ports.length !== 1) return;
    const parsed = initSchema.safeParse(event.data);
    if (!parsed.success || parsed.data.nonce !== nonce) return;
    accepted = true; port = event.ports[0]!;
    // Serialize seeks and edits so a slow load cannot overwrite a newer props update.
    let queue = Promise.resolve();
    port.onmessage = (message) => {
      const request = commandSchema.safeParse(message.data);
      if (!request.success) return;
      queue = queue.then(async () => { try { const result = await execute(request.data); port?.postMessage({ version: 1, id: request.data.id, ok: true, result }); } catch (r) { port?.postMessage({ version: 1, id: request.data.id, ok: false, error: r instanceof Error ? r.message : 'Composition command failed' }); } });
    };
    port.start(); window.removeEventListener('message', init);
  };
  const fit = () => {
    const stage = window.document.querySelector<HTMLElement>('[data-composition-id]');
    if (!stage) return;
    const width = Number(stage.dataset.width) || 1920, height = Number(stage.dataset.height) || 1080;
    stage.style.transformOrigin = 'top left';
    stage.style.transform = `scale(${Math.min(window.innerWidth / width, window.innerHeight / height)})`;
  };
  fit(); window.addEventListener('resize', fit);
  window.addEventListener('message', init);
  const notify = () => { window.setTimeout(() => window.parent.postMessage({ type: 'cutroom-bridge-ready', nonce }, allowedOrigin), 0); };
  if (window.document.readyState === 'complete') notify(); else window.addEventListener('load', notify, { once: true });
  return () => { window.removeEventListener('message', init); window.removeEventListener('resize', fit); window.removeEventListener('load', notify); port?.close(); };
}
if (typeof window !== 'undefined' && window.__CUTROOM_APP_ORIGIN__) {
  const ready = () => installHost(window, window.__CUTROOM_APP_ORIGIN__!);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true }); else ready();
}
