import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WhisperModels } from '@main/whisper/models';
import { SettingsStore } from '@main/settings/store';
import type { ModelPin } from '@main/tools/manifest';
import type { Fetch } from '@main/tools/download';

const roots: string[] = []; const services: WhisperModels[] = [];
afterEach(async () => { await Promise.all(services.splice(0).map((service) => service.close())); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const bytes = 'test model bytes'; const digest = createHash('sha256').update(bytes).digest('hex');
const pin = (name: ModelPin['name']): ModelPin => ({ name, url: `https://huggingface.co/${name}`, sizeBytes: Buffer.byteLength(bytes), sha256: digest, allowedHosts: ['huggingface.co'], allowedHostSuffixes: ['.hf.co'] });
async function fixture(fetch: Fetch = async () => new Response(bytes)): Promise<{ home: string; service: WhisperModels; settings: SettingsStore }> {
  const home = await mkdtemp(path.join(tmpdir(), 'cutroom-models-test-')); roots.push(home);
  const settings = await SettingsStore.load(home); const service = new WhisperModels({ home, pins: [pin('base'), pin('small')], settings, fetch }); services.push(service); await service.initialize(); return { home, service, settings };
}
describe('Whisper models', () => {
  it('downloads the default once, reports installed, persists selection and deletes explicitly', async () => {
    const fetch = vi.fn<Fetch>(async () => new Response(bytes)); const { home, service } = await fixture(fetch);
    expect((await service.list())[0]).toMatchObject({ name: 'base', status: 'missing', isDefault: true });
    await service.ensureDefault(); await service.ensureDefault(); expect(fetch).toHaveBeenCalledOnce();
    expect((await service.list())[0]?.status).toBe('installed');
    await service.download('small'); await service.setDefault('small'); expect((await SettingsStore.load(home)).get().whisperModel).toBe('small');
    expect((await service.list())[1]).toMatchObject({ status: 'installed', isDefault: true });
    await service.delete('small'); expect((await service.list())[1]?.status).toBe('missing');
    expect((await readdir(path.join(home, 'models'))).some((file) => file.startsWith('.staging-'))).toBe(false);
  });
  it('never reports a mismatching file as installed and does not overwrite it', async () => {
    const { home, service } = await fixture(); await mkdir(path.join(home, 'models'));
    const file = path.join(home, 'models/ggml-base.bin'); await writeFile(file, 'x'.repeat(bytes.length));
    expect((await service.list())[0]?.status).toBe('checksum_mismatch');
    await expect(service.download('base')).rejects.toMatchObject({ code: 'unavailable' }); expect(await readFile(file, 'utf8')).toBe('x'.repeat(bytes.length));
  });
  it('rejects a checksum mismatch before publishing the model', async () => {
    const { service, home } = await fixture(async () => new Response('x'.repeat(bytes.length)));
    await expect(service.download('base')).rejects.toMatchObject({ code: 'unavailable' });
    expect((await service.list())[0]).toMatchObject({ status: 'missing', install: { state: 'failed' } }); expect(await readdir(path.join(home, 'models'))).toEqual([]);
  });
  it('cancels a download and removes all staging files', async () => {
    let started = (): void => {}; const ready = new Promise<void>((resolve) => { started = resolve; });
    const { home, service } = await fixture(async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])); started(); } })));
    const done = service.download('base'); const rejected = expect(done).rejects.toMatchObject({ code: 'unavailable' }); await ready;
    await service.cancel('base'); await rejected; expect(await readdir(path.join(home, 'models'))).toEqual([]); expect((await service.list())[0]?.install).toBeNull();
  });
  it('refuses traversal names and symlink deletion without mutating the outside file', async () => {
    const { home, service } = await fixture(); await mkdir(path.join(home, 'models')); const outside = path.join(home, 'outside'); await writeFile(outside, bytes);
    await symlink(outside, path.join(home, 'models/ggml-base.bin'));
    await expect(service.delete('../base')).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(service.delete('base')).rejects.toMatchObject({ code: 'forbidden' }); expect(await readFile(outside, 'utf8')).toBe(bytes);
  });
  it('reuses persisted stat verification on restart and detects later tampering', async () => {
    const { home, service, settings } = await fixture(); await service.download('base');
    const next = new WhisperModels({ home, settings, pins: [pin('base')], fetch: vi.fn() }); services.push(next); await next.initialize();
    expect((await next.list())[0]?.status).toBe('installed');
    await writeFile(path.join(home, 'models/ggml-base.bin'), 'tampered'); expect((await next.list())[0]?.status).toBe('checksum_mismatch');
  });
});
