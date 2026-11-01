import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod/v3';
import { contract, type InvokeChannel } from '@shared/ipc/contract';
import { createRequestHandler, reply, validatedEmit, isAppSender } from '@main/ipc/validation';
import { createBridge, type BridgeTransport } from '../../src/preload/bridge';

const sender = { frameUrl: 'app://cutroom/', isMainFrame: true, destroyed: false };
const options = { validateResponse: true };
const allowed = { invoke: Object.keys(contract.invoke), events: Object.keys(contract.events) };
function transport(): BridgeTransport {
  return { invoke: vi.fn(async () => ({ ok: true, data: { pong: true } })), subscribe: vi.fn(() => vi.fn()), getPathForFile: () => '/selected/file' };
}

describe('main IPC validation', () => {
  it('rejects invalid payloads and resolves valid typed requests', async () => {
    const impl = vi.fn(() => ({ pong: true as const }));
    const run = createRequestHandler(contract.invoke['app.ping'], impl, options);
    await expect(run(sender, { extra: true })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(impl).not.toHaveBeenCalled();
    await expect(run(sender, {})).resolves.toEqual({ pong: true });
  });
  it.each([
    { ...sender, frameUrl: 'https://example.com/' },
    { ...sender, isMainFrame: false },
    { ...sender, destroyed: true },
    { ...sender, frameUrl: 'app://cutroom.evil/' },
  ])('rejects non-app sender %j', async (bad) => {
    const run = createRequestHandler(contract.invoke['app.ping'], () => ({ pong: true as const }), options);
    await expect(run(bad, {})).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('accepts only configured development origin', () => {
    expect(isAppSender({ ...sender, frameUrl: 'http://localhost:5173/' }, 'http://localhost:5173')).toBe(true);
    expect(isAppSender({ ...sender, frameUrl: 'http://localhost:5174/' }, 'http://localhost:5173')).toBe(false);
  });
  it('validates responses in development', async () => {
    const run = createRequestHandler({ req: z.object({}), res: z.object({ n: z.number() }) }, () => ({ n: 'bad' } as unknown as { n: number }), options);
    await expect(run(sender, {})).rejects.toMatchObject({ code: 'internal' });
  });
  it('does not leak internal error messages or stacks', async () => {
    expect(await reply(async () => { throw new Error('secret path'); })).toEqual({ ok: false, error: { code: 'internal', message: 'An internal error occurred.' } });
  });
  it('never emits malformed event payloads', () => {
    const send = vi.fn();
    expect(validatedEmit(contract.events['app.ready'], { version: 42 }, send)).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(validatedEmit(contract.events['app.ready'], { version: '0.1.0' }, send)).toBe(true);
    expect(send).toHaveBeenCalledWith({ version: '0.1.0' });
  });
});

describe('sandboxed preload bridge', () => {
  it('has exactly the three permitted capabilities', () => {
    expect(Object.keys(createBridge(transport(), allowed))).toEqual(['invoke', 'on', 'getPathForFile']);
  });
  it('rejects channels outside the generated allowlist', async () => {
    const wire = transport(); const bridge = createBridge(wire, allowed);
    await expect(bridge.invoke('shell.run' as InvokeChannel, {})).rejects.toMatchObject({ code: 'forbidden' });
    expect(wire.invoke).not.toHaveBeenCalled();
  });
  it('preserves typed result and error envelopes across the context bridge', async () => {
    const wire = transport(); const bridge = createBridge(wire, allowed);
    await expect(bridge.invoke('app.ping', {})).resolves.toEqual({ ok: true, data: { pong: true } });
    wire.invoke = async () => ({ ok: false, error: { code: 'conflict', message: 'Changed' } });
    await expect(bridge.invoke('app.ping', {})).resolves.toEqual({ ok: false, error: { code: 'conflict', message: 'Changed' } });
  });
  it('sanitizes malformed replies and unexpected transport rejections', async () => {
    const wire = transport(); const bridge = createBridge(wire, allowed);
    wire.invoke = async () => ({ ok: true, data: { pong: 'bad' } });
    await expect(bridge.invoke('app.ping', {})).resolves.toMatchObject({ ok: false, error: { code: 'internal' } });
    wire.invoke = async () => { throw new Error('secret path'); };
    await expect(bridge.invoke('app.ping', {})).resolves.toEqual({ ok: false, error: { code: 'internal', message: 'The app connection is unavailable.' } });
  });
  it('only imports paths granted by a real File handoff, once', async () => {
    const wire = transport(); wire.invoke = vi.fn(async () => ({ ok: true, data: [] }));
    const bridge = createBridge(wire, allowed);
    const request = { paths: ['/selected/file'], destination: 'raw' as const };
    expect(await bridge.invoke('media.importPaths', request)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(wire.invoke).not.toHaveBeenCalled();
    bridge.getPathForFile({} as File);
    expect(await bridge.invoke('media.importPaths', request)).toEqual({ ok: true, data: [] });
    expect(await bridge.invoke('media.importPaths', request)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(wire.invoke).toHaveBeenCalledOnce();
  });
  it('expires File handoffs and rejects malformed import payloads before transport', async () => {
    const wire = transport(); const bridge = createBridge(wire, allowed);
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    try {
      bridge.getPathForFile({} as File); now.mockReturnValue(1000 + 10 * 60_000 + 1);
      expect(await bridge.invoke('media.importPaths', { paths: ['/selected/file'], destination: 'raw' })).toMatchObject({ ok: false, error: { code: 'forbidden' } });
      expect(await bridge.invoke('media.importPaths', { paths: [], destination: 'raw' })).toMatchObject({ ok: false, error: { code: 'invalid_request' } });
      expect(wire.invoke).not.toHaveBeenCalled();
    } finally { now.mockRestore(); }
  });
  it('filters invalid events and unsubscribes', () => {
    const wire = transport(); let deliver: (payload: unknown) => void = () => {};
    const unsubscribe = vi.fn(); wire.subscribe = (_event, cb) => { deliver = cb; return unsubscribe; };
    const cb = vi.fn(); const off = createBridge(wire, allowed).on('app.ready', cb);
    deliver({ version: 42 }); expect(cb).not.toHaveBeenCalled();
    deliver({ version: '0.1.0' }); expect(cb).toHaveBeenCalledOnce();
    off(); expect(unsubscribe).toHaveBeenCalledOnce();
  });
  it('supports a test-only contract channel without editing bridge source', async () => {
    vi.resetModules();
    vi.doMock('@shared/ipc/contract', async () => {
      const actual = await vi.importActual<typeof import('@shared/ipc/contract')>('@shared/ipc/contract');
      return { ...actual, contract: { ...actual.contract, invoke: { ...actual.contract.invoke, 'test.echo': { req: z.object({ value: z.string() }), res: z.object({ value: z.string() }) } } } };
    });
    try {
      const { createBridge: extendedBridge } = await import('../../src/preload/bridge');
      const wire = transport(); wire.invoke = async (_channel, req) => ({ ok: true, data: req });
      const bridge = extendedBridge(wire, { invoke: [...allowed.invoke, 'test.echo'], events: allowed.events });
      await expect(bridge.invoke('test.echo' as InvokeChannel, { value: 'works' })).resolves.toEqual({ ok: true, data: { value: 'works' } });
    } finally { vi.doUnmock('@shared/ipc/contract'); vi.resetModules(); }
  });
});
