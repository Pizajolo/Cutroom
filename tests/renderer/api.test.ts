import { describe, expect, it, vi } from 'vitest';
import type { CutroomBridge } from '@shared/ipc/bridge';
import { IpcFailure } from '@shared/ipc';
import { createApi } from '../../src/renderer/lib/api';

function fixture() {
  const invoke = vi.fn<CutroomBridge['invoke']>();
  const unsubscribe = vi.fn();
  const on = vi.fn<CutroomBridge['on']>(() => unsubscribe);
  const getPathForFile = vi.fn<CutroomBridge['getPathForFile']>(() => '/chosen/file.mov');
  return { invoke, on, getPathForFile, unsubscribe, api: createApi(() => ({ invoke, on, getPathForFile })) };
}

describe('renderer IPC client', () => {
  it('unwraps the resolved data envelope without changing the request', async () => {
    const { api, invoke } = fixture(); invoke.mockResolvedValue({ ok: true, data: { pong: true } });
    expect(await api.invoke('app.ping', {})).toEqual({ pong: true }); expect(invoke).toHaveBeenCalledWith('app.ping', {});
  });
  it('constructs a renderer-local IpcFailure so code and details survive contextBridge', async () => {
    const { api, invoke } = fixture();
    invoke.mockResolvedValue({ ok: false, error: { code: 'conflict', message: 'This item changed.', details: { itemId: 'clip_1234567890' } } });
    await expect(api.invoke('app.ping', {})).rejects.toBeInstanceOf(IpcFailure);
    await expect(api.invoke('app.ping', {})).rejects.toMatchObject({ code: 'conflict', details: { itemId: 'clip_1234567890' } });
  });
  it('returns the bridge event disposer and hands File objects only to the preload', () => {
    const { api, on, unsubscribe, getPathForFile } = fixture(); const listener = vi.fn();
    api.on('app.ready', listener)(); expect(on).toHaveBeenCalledWith('app.ready', listener); expect(unsubscribe).toHaveBeenCalledOnce();
    const file = new File(['clip'], 'clip.mov'); expect(api.getPathForFile(file)).toBe('/chosen/file.mov'); expect(getPathForFile).toHaveBeenCalledWith(file);
  });
  it('reports an unavailable desktop bridge rather than creating a production stub', async () => {
    const api = createApi(() => undefined);
    await expect(api.invoke('app.getInfo', {})).rejects.toMatchObject({ code: 'internal', message: expect.stringContaining('desktop connection') });
  });
});
