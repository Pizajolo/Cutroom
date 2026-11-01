import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseRange, startMediaServer } from '../../src/main/server/mediaServer';

type Server = Awaited<ReturnType<typeof startMediaServer>>;
let directory: string; let root: string; let server: Server; let port: string; let prefix: string;
const projects = new Map<string, string>();
async function get(target: string, headers: Record<string, string> = {}, method = 'GET'): Promise<{ status: number; headers: Record<string, unknown>; body: string }> {
  return new Promise((resolve, reject) => {
    const client = request({ hostname: '127.0.0.1', port, path: target, headers, method, agent: false }, (response) => {
      const chunks: Buffer[] = []; response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks).toString() }));
      response.on('error', reject);
    }); client.on('error', reject); client.end();
  });
}
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'cutroom-media-server-test-')); root = path.join(directory, 'project');
  await mkdir(path.join(root, 'raw'), { recursive: true }); await writeFile(path.join(root, 'raw/clip.mp4'), '0123456789');
  projects.set('project', root);
  server = await startMediaServer({ projectRoot: (id) => projects.get(id), devOrigin: 'http://127.0.0.1:5173' });
  const url = new URL(server.baseUrl); port = url.port; prefix = url.pathname;
});
afterEach(async () => { if (server) await server.close(); projects.clear(); if (directory) await rm(directory, { recursive: true, force: true }); });
describe('tokenized loopback media server', () => {
  it('serves media and HEAD with no-store, MIME and a 32-byte token', async () => {
    expect(new URL(server.baseUrl).hostname).toBe('127.0.0.1');
    expect(prefix.split('/').pop()).toMatch(/^[a-f0-9]{64}$/);
    const response = await get(`${prefix}/p/project/raw/clip.mp4`);
    expect(response).toMatchObject({ status: 200, body: '0123456789', headers: { 'content-type': 'video/mp4', 'cache-control': 'no-store', 'accept-ranges': 'bytes', 'x-content-type-options': 'nosniff' } });
    expect(await get(`${prefix}/p/project/raw/clip.mp4`, {}, 'HEAD')).toMatchObject({ status: 200, body: '', headers: { 'content-length': '10' } });
  });
  it('supports closed, open, suffix and clamped ranges', async () => {
    const target = `${prefix}/p/project/raw/clip.mp4`;
    await writeFile(path.join(root, 'raw/larger.mp4'), Buffer.alloc(256, 65));
    expect(await get(`${prefix}/p/project/raw/larger.mp4`, { Range: 'bytes=0-99' })).toMatchObject({ status: 206, body: 'A'.repeat(100), headers: { 'content-range': 'bytes 0-99/256', 'content-length': '100' } });
    expect(await get(target, { Range: 'bytes=2-5' })).toMatchObject({ status: 206, body: '2345', headers: { 'content-range': 'bytes 2-5/10', 'content-length': '4' } });
    expect(await get(target, { Range: 'bytes=7-' })).toMatchObject({ status: 206, body: '789' });
    expect(await get(target, { Range: 'bytes=-4' })).toMatchObject({ status: 206, body: '6789' });
    expect(await get(target, { Range: 'bytes=8-99' })).toMatchObject({ status: 206, body: '89' });
    for (const range of ['bytes=10-', 'bytes=4-2', 'bytes=-0', 'bytes=0-1,4-5', 'items=1-2', 'bytes=9007199254740992-']) expect(await get(target, { Range: range })).toMatchObject({ status: 416, headers: { 'content-range': 'bytes */10' } });
  });
  it('rejects missing/wrong tokens and all non-app/non-dev origins', async () => {
    expect((await get('/p/project/raw/clip.mp4')).status).toBe(403);
    expect((await get('/k/wrong/p/project/raw/clip.mp4')).status).toBe(403);
    const target = `${prefix}/p/project/raw/clip.mp4`;
    for (const origin of ['https://example.com', 'null', 'http://127.0.0.1:5174', 'app://evil']) expect((await get(target, { Origin: origin })).status).toBe(403);
    expect((await get(target, { Origin: 'app://cutroom' })).headers['access-control-allow-origin']).toBe('app://cutroom');
    expect((await get(target, { Origin: 'http://127.0.0.1:5173' }, 'OPTIONS')).status).toBe(204);
  });
  it('rejects raw/encoded traversal, absolute paths and symlink escapes', async () => {
    const outside = path.join(directory, 'project-outside'); await mkdir(outside); await writeFile(path.join(outside, 'secret.txt'), 'not served');
    await symlink(outside, path.join(root, 'escape'));
    for (const rel of ['../project-outside/secret.txt', '..%2f..%2fetc%2fpasswd', 'raw/../../project-outside/secret.txt', '%2e%2e/project-outside/secret.txt', '%252e%252e/project-outside/secret.txt', '%2Fetc/passwd', 'escape/secret.txt', 'raw/%00.mp4']) expect((await get(`${prefix}/p/project/${rel}`)).status).toBe(403);
    expect((await get(`${prefix}/p/project/raw/clip.mp4`, {}, 'POST')).status).toBe(405);
  });
  it('revokes an old project root and never serves directories', async () => {
    expect((await get(`${prefix}/p/project/raw`)).status).toBe(404);
    projects.delete('project'); expect((await get(`${prefix}/p/project/raw/clip.mp4`)).status).toBe(404);
  });
});
describe('byte-range parser', () => {
  it('handles empty files and refuses unsafe integers', () => {
    expect(parseRange(undefined, 0)).toBeUndefined();
    expect(parseRange('bytes=0-', 0)).toBe('unsatisfiable');
    expect(parseRange('bytes=-999', 10)).toEqual({ start: 0, end: 9 });
  });
});
