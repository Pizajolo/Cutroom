import { randomBytes, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { pipeline } from 'node:stream/promises';
import { resolveInProject, PathError } from '../fs/safePath';

export interface MediaServerOptions {
  projectRoot: (id: string) => string | undefined;
  devOrigin?: string;
}
export type ByteRange = { start: number; end: number } | 'unsatisfiable' | undefined;
export function parseRange(header: string | undefined, size: number): ByteRange {
  if (!header) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || size === 0) return 'unsatisfiable';
  let start: number; let end: number;
  if (!match[1]) { const suffix = Number(match[2]); if (!Number.isSafeInteger(suffix) || suffix <= 0) return 'unsatisfiable'; start = Math.max(0, size - suffix); end = size - 1; }
  else { start = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1; }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return 'unsatisfiable';
  return { start, end: Math.min(end, size - 1) };
}
const mimeTypes: Record<string, string> = {
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4v: 'video/mp4', mkv: 'video/x-matroska',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', ogg: 'audio/ogg',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff', aif: 'audio/aiff', aiff: 'audio/aiff', json: 'application/json',
};
export function mediaMime(rel: string): string { return mimeTypes[rel.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream'; }
export async function resolveMediaPath(root: string, encoded: string): Promise<string> {
  let literal: string;
  try { literal = decodeURIComponent(encoded); } catch { throw new PathError('Invalid path encoding'); }
  return resolveInProject(root, literal);
}
export async function startMediaServer(options: MediaServerOptions): Promise<{ baseUrl: string; url: (projectId: string, rel: string) => string; close: () => Promise<void> }> {
  const token = randomBytes(32).toString('hex');
  const allowedOrigins = new Set(['app://cutroom']);
  if (options.devOrigin) allowedOrigins.add(new URL(options.devOrigin).origin);
  const serve = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Vary', 'Origin');
    const fail = (status: number): void => { response.statusCode = status; response.end(); };
    if (request.headers.origin && !allowedOrigins.has(request.headers.origin)) { fail(403); return; }
    if (request.headers.origin) response.setHeader('Access-Control-Allow-Origin', request.headers.origin);
    // Parse the raw request target, not URL.pathname: URL normalization would hide traversal attempts.
    const rawPath = request.url?.split('?')[0] ?? '';
    const parts = /^\/k\/([^/]+)\/p\/([A-Za-z0-9_-]+)\/(.+)$/.exec(rawPath);
    const supplied = Buffer.from(parts?.[1] ?? ''); const expected = Buffer.from(token);
    if (!parts || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { fail(403); return; }
    if (request.method === 'OPTIONS') {
      response.setHeader('Access-Control-Allow-Methods', 'GET, HEAD'); response.setHeader('Access-Control-Allow-Headers', 'Range'); fail(204); return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.setHeader('Allow', 'GET, HEAD'); fail(405); return; }
    const projectId = parts[2]; const rel = parts[3];
    const root = projectId ? options.projectRoot(projectId) : undefined;
    if (!root || !rel) { fail(404); return; }
    let handle: FileHandle | undefined;
    try {
      const file = await resolveMediaPath(root, rel);
      handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const stat = await handle.stat();
      if (!stat.isFile()) { fail(404); return; }
      response.setHeader('Content-Type', mediaMime(file)); response.setHeader('Accept-Ranges', 'bytes');
      response.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
      const range = parseRange(request.headers.range, stat.size);
      if (range === 'unsatisfiable') { response.setHeader('Content-Range', `bytes */${stat.size}`); fail(416); return; }
      response.statusCode = range ? 206 : 200;
      if (range) response.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${stat.size}`);
      response.setHeader('Content-Length', range ? range.end - range.start + 1 : stat.size);
      if (request.method === 'HEAD' || stat.size === 0) { response.end(); return; }
      await pipeline(handle.createReadStream({ ...(range ?? {}), autoClose: true }), response);
    } catch (error) {
      if (!response.headersSent) fail(error instanceof PathError ? 403 : 404);
      else response.destroy();
    } finally { await handle?.close().catch(() => undefined); }
  };
  const server = createServer((request, response) => { void serve(request, response); });
  server.requestTimeout = 30_000; server.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Media server did not bind');
  const baseUrl = `http://127.0.0.1:${address.port}/k/${token}`;
  return {
    baseUrl,
    url: (projectId, rel) => `${baseUrl}/p/${encodeURIComponent(projectId)}/${rel.split('/').map(encodeURIComponent).join('/')}`,
    close: () => new Promise<void>((resolve, reject) => { server.close((error) => error ? reject(error) : resolve()); server.closeAllConnections(); }),
  };
}
