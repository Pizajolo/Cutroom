import { describe, expect, it, vi } from 'vitest';
import { contract, type InvokeChannel } from '@shared/ipc/contract';
import { registerStartupIpc, type StartupIpcServices } from '@main/ipc/startup';
import { stubChannels } from '@main/ipc/stubs';
import { scaffoldRequests } from './scaffoldRequests';
import { createBridge } from '../../src/preload/bridge';

const registered = vi.hoisted(() => new Map<string, (event: unknown, request: unknown) => Promise<unknown>>());
vi.mock('electron', () => ({
  app: { isPackaged: false }, BrowserWindow: { getAllWindows: () => [] }, dialog: {}, shell: {},
  ipcMain: { handle: (channel: string, listener: (event: unknown, request: unknown) => Promise<unknown>) => {
    if (registered.has(channel)) throw new Error(`Duplicate IPC handler: ${channel}`);
    registered.set(channel, listener);
  } },
}));

const frame = { url: 'app://cutroom/' };
const event = { senderFrame: frame, sender: { mainFrame: frame, isDestroyed: () => false } };
const getInfo = () => ({ version: '0.1.0', platform: 'darwin', arch: 'arm64', homeDir: '/home', mediaBaseUrl: null, compBaseUrl: null });
// No service methods are called during registration. A call would throw and fail the test.
const unused = new Proxy({}, { get: () => { throw new Error('Registration must not run service actions'); } });
function startup(): void {
  registered.clear();
  registerStartupIpc({ registry: unused, media: unused, installer: unused, models: unused, accounts: unused, claude: unused, workflows: unused, getInfo } as StartupIpcServices);
}

describe('production startup IPC wiring', () => {
  it('registers exactly one real or stub handler for every invoke channel', () => {
    startup();
    expect([...registered.keys()].sort()).toEqual(Object.keys(contract.invoke).sort());
    expect(registered.size).toBe(Object.keys(contract.invoke).length);
  });
  it('keeps working app handlers and all new unavailable replies usable through the bridge', async () => {
    startup();
    const bridge = createBridge({
      invoke: async (channel: string, request: unknown) => {
        const listener = registered.get(channel);
        if (!listener) throw new Error('No registered handler');
        return listener(event, request);
      }, subscribe: () => () => {}, getPathForFile: () => '',
    }, { invoke: Object.keys(contract.invoke), events: Object.keys(contract.events) });
    await expect(bridge.invoke('app.ping', {})).resolves.toEqual({ ok: true, data: { pong: true } });
    await expect(bridge.invoke('app.getInfo', {})).resolves.toEqual({ ok: true, data: getInfo() });
    for (const channel of stubChannels) {
      await expect(bridge.invoke(channel, scaffoldRequests[channel]), channel).resolves.toMatchObject({ ok: false, error: { code: 'unavailable' } });
    }
    await expect(bridge.invoke('urlImport.download', { ...scaffoldRequests['urlImport.download'], rightsConfirmed: false } as unknown as Parameters<typeof bridge.invoke<'urlImport.download'>>[1])).resolves.toMatchObject({ ok: false, error: { code: 'invalid_request' } });
    const voice = registered.get('voice.transcribe' satisfies InvokeChannel);
    await expect(voice?.(event, { ...scaffoldRequests['voice.transcribe'], audio: new Uint8Array(10 * 1024 * 1024 + 1) })).resolves.toMatchObject({ ok: false, error: { code: 'invalid_request' } });
  });
});
