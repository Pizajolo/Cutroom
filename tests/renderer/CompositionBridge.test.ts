import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CompositionBridge } from '../../src/renderer/lib/compBridge';
import { installHost } from '../../src/compositions/bridge/host';
import type { PropsDoc } from '@shared/schema/props';

// Deterministic transport for origin/nonce tests. Native opaque-frame transfer is
// exercised separately by preview/bridge.html in the real browser.
class Port {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  peer!: Port;
  closed = false;
  postMessage = vi.fn((data: unknown) => { queueMicrotask(() => { if (!this.closed && !this.peer.closed) this.peer.onmessage?.({ data }); }); });
  start = vi.fn();
  close = vi.fn(() => { this.closed = true; });
}
class Channel {
  port1 = new Port(); port2 = new Port();
  constructor() { this.port1.peer = this.port2; this.port2.peer = this.port1; }
}
const schema: PropsDoc = { version: 1, elements: [{ id: 'title', name: 'Title', kind: 'text', props: { content: { type: 'text', bind: 'text', default: 'Title' } } }] };
let dispose: (() => void)[];
beforeEach(() => { vi.stubGlobal('MessageChannel', Channel); dispose = []; });
afterEach(() => { dispose.forEach((close) => close()); document.body.replaceChildren(); history.replaceState(null, '', '/'); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
function client() {
  const iframe = document.createElement('iframe'); document.body.append(iframe);
  const bridge = new CompositionBridge(iframe, 'http://127.0.0.1:9000/k/token/builtin/title-card/index.html', 100);
  const post = vi.spyOn(iframe.contentWindow!, 'postMessage').mockImplementation(() => {});
  dispose.push(() => bridge.dispose()); iframe.dispatchEvent(new Event('load'));
  const nonce = new URLSearchParams(new URL(iframe.src).hash.slice(1)).get('n')!;
  const ready = (origin = 'null', source: MessageEventSource | null = iframe.contentWindow, n = nonce) => window.dispatchEvent(new MessageEvent('message', { origin, source, data: { type: 'cutroom-bridge-ready', nonce: n } }));
  return { iframe, post, bridge, nonce, ready };
}
it('requires exact frame source, opaque origin and per-load nonce before transferring one port', () => {
  const c = client(); c.ready('http://evil.test'); c.ready('null', window); c.ready('null', c.iframe.contentWindow, 'wrong-nonce-12345'); expect(c.post).not.toHaveBeenCalled();
  c.ready(); c.ready(); expect(c.post).toHaveBeenCalledTimes(1);
  expect(c.post).toHaveBeenCalledWith({ type: 'cutroom-bridge-init', nonce: c.nonce }, '*', [expect.any(Port)]);
  expect(Object.keys(c.post.mock.calls[0]![0])).toEqual(['type', 'nonce']);
});
it('sends props only on the private port and ignores window replies and mismatched ids', async () => {
  const c = client(); c.ready(); const port = (c.post.mock.calls as unknown as [unknown, string, Port[]][])[0]![2][0]!;
  const request = c.bridge.request({ command: 'setProps', schema, props: { title: { content: 'Private title' } } });
  const payload = port.peer.postMessage.mock.calls[0]![0] as { id: string };
  expect(c.post).toHaveBeenCalledTimes(1); expect(JSON.stringify(c.post.mock.calls.map((call) => call[0]))).not.toContain('Private title');
  const complete = vi.fn(); void request.then(complete);
  window.dispatchEvent(new MessageEvent('message', { origin: 'http://evil.test', source: c.iframe.contentWindow, data: { version: 1, id: payload.id, ok: true } }));
  port.postMessage({ version: 1, id: 'another-id', ok: true }); await Promise.resolve(); expect(complete).not.toHaveBeenCalled();
  port.postMessage({ version: 1, id: payload.id, ok: true, result: { updated: true } }); expect(await request).toEqual({ updated: true });
});
it('closes the old port, rejects pending requests and changes nonce on unexpected reload', async () => {
  const c = client(); c.ready(); const port = (c.post.mock.calls as unknown as [unknown, string, Port[]][])[0]![2][0]!;
  const pending = c.bridge.request({ command: 'seek', time: 1 }); const rejected = expect(pending).rejects.toThrow('Composition reloaded.');
  c.iframe.dispatchEvent(new Event('load')); await rejected; expect(port.peer.close).toHaveBeenCalled();
  expect(new URLSearchParams(new URL(c.iframe.src).hash.slice(1)).get('n')).not.toBe(c.nonce);
  c.ready(); expect(c.post).toHaveBeenCalledTimes(1);
});
it('times out unanswered commands and rejects readiness waits immediately on disposal', async () => {
  const c = client(); c.ready(); vi.useFakeTimers(); const pending = c.bridge.request({ command: 'pause' }); const rejected = expect(pending).rejects.toThrow('timed out'); await vi.advanceTimersByTimeAsync(101); await rejected;
  const unready = client(); const waiting = unready.bridge.request({ command: 'load' }); const closed = expect(waiting).rejects.toThrow('closed'); unready.bridge.dispose(); await closed;
});
function host() {
  history.replaceState(null, '', '/#n=fixture-nonce-123456'); document.body.innerHTML = '<main data-composition-id="title-card" data-width="1920" data-height="1080"><h1 data-cut-id="title">Title</h1></main>';
  const seek = vi.fn(); window.__timelines = { title: { seek, play: vi.fn(), pause: vi.fn() } };
  const close = installHost(window, 'http://localhost:3000'); dispose.push(close);
  const init = (port: Port, origin = 'http://localhost:3000', nonce = 'fixture-nonce-123456') => window.dispatchEvent(new MessageEvent('message', { origin, source: window.parent, ports: [port as unknown as MessagePort], data: { type: 'cutroom-bridge-init', nonce } }));
  return { init, seek };
}
it('host rejects wrong app origin, nonce and malformed commands, and accepts only the first port', async () => {
  const h = host(); const bad = new Channel(), good = new Channel(), second = new Channel();
  h.init(bad.port2, 'http://evil.test'); h.init(bad.port2, 'http://localhost:3000', 'wrong-nonce-12345'); expect(bad.port2.start).not.toHaveBeenCalled();
  h.init(good.port2); h.init(second.port2); expect(second.port2.start).not.toHaveBeenCalled();
  good.port1.postMessage({ version: 1, id: '1', command: 'seek', time: -1 }); await Promise.resolve(); expect(h.seek).not.toHaveBeenCalled();
  window.dispatchEvent(new MessageEvent('message', { origin: 'http://localhost:3000', source: window.parent, data: { version: 1, id: '2', command: 'seek', time: 1 } })); expect(h.seek).not.toHaveBeenCalled();
  good.port1.postMessage({ version: 1, id: '3', command: 'seek', time: 1 }); await vi.waitFor(() => expect(h.seek).toHaveBeenCalledWith(1, false));
});
it('host loads title props and seeks through its validated private channel', async () => {
  const h = host(); const channel = new Channel(); h.init(channel.port2);
  channel.port1.postMessage({ version: 1, id: '1', command: 'load', schema, props: { title: { content: 'Coast at dawn' } } });
  channel.port1.postMessage({ version: 1, id: '2', command: 'seek', time: 1 });
  await vi.waitFor(() => expect(document.querySelector('[data-cut-id="title"]')?.textContent).toBe('Coast at dawn'));
  await vi.waitFor(() => expect(h.seek).toHaveBeenCalledWith(1, false));
});
