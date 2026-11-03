import { randomBytes, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { managedPath } from '../fs/managed';
import { resolveInProject } from '../fs/safePath';

export interface CompositionServerOptions { projectRoot: (id: string) => string | undefined; compositionsRoot: string; mediaBaseUrl: string; devOrigin?: string; runtimeFiles?: Record<string, string> }
const require = createRequire(import.meta.url);
const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
export async function resolveCompositionPath(options: CompositionServerOptions, encoded: string): Promise<string> {
  const rel = decodeURIComponent(encoded); if (rel.includes('\\') || rel.includes('\0') || rel.split('/').some((part) => part === '..' || part === '.')) throw new Error('Invalid path');
  const runtime = options.runtimeFiles?.[rel]; if (runtime) return runtime;
  const project = /^p\/([A-Za-z0-9_-]+)\/compositions\/([a-zA-Z0-9][a-zA-Z0-9_-]*)\/(.+)$/.exec(rel);
  if (project) { const root = options.projectRoot(project[1]!); if (!root) throw new Error('Project not found'); const compositions = await managedPath(root, 'compositions'); return resolveInProject(compositions, `${project[2]}/${project[3]}`); }
  if (/^(bridge|builtin)\/.+/.test(rel)) return resolveInProject(options.compositionsRoot, rel);
  throw new Error('Composition resource not found');
}
export async function startCompositionServer(input: CompositionServerOptions): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const token = randomBytes(32).toString('hex'); let boundHost = '';
  const options: CompositionServerOptions = { ...input, runtimeFiles: input.runtimeFiles ?? {
    'runtime/bridge.js': path.join(input.compositionsRoot, 'runtime/bridge.js'),
    'runtime/gsap.min.js': require.resolve('gsap/dist/gsap.min.js'),
    'runtime/hyperframes.js': path.join(path.dirname(require.resolve('hyperframes/package.json')), 'dist/hyperframe.runtime.iife.js'),
  } };
  const mediaOrigin = new URL(input.mediaBaseUrl).origin; const ancestors = ['app://cutroom', ...(input.devOrigin ? [new URL(input.devOrigin).origin] : [])];
  const serve = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff'); response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: ${mediaOrigin}; media-src ${mediaOrigin} blob:; font-src 'self' data:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors ${ancestors.join(' ')}; sandbox allow-scripts`);
    const fail = (status: number): void => { response.statusCode = status; response.end(); };
    const match = /^\/k\/([^/]+)\/(.+)$/.exec(request.url?.split('?')[0] ?? ''); const supplied = Buffer.from(match?.[1] ?? ''); const expected = Buffer.from(token);
    if (!match || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { fail(403); return; }
    if (request.headers.host !== boundHost) { fail(403); return; }
    const origin = request.headers.origin; if (origin && origin !== 'null' && !ancestors.includes(origin)) { fail(403); return; } if (origin) { response.setHeader('Access-Control-Allow-Origin', origin); response.setHeader('Vary', 'Origin'); }
    if (!['GET', 'HEAD'].includes(request.method ?? '')) { fail(405); return; }
    let handle;
    try {
      const file = await resolveCompositionPath(options, match[2]!); handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); const info = await handle.stat(); if (!info.isFile() || info.size > 32 * 1024 * 1024) { fail(404); return; }
      response.setHeader('Content-Type', mime[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
      if (path.extname(file).toLowerCase() === '.html') {
        const host = request.headers.host; if (!host || !/^127\.0\.0\.1:\d+$/.test(host)) { fail(403); return; }
        const base = `http://${host}/k/${token}/`; const appOrigin = input.devOrigin ? new URL(input.devOrigin).origin : 'app://cutroom';
        const injection = `<script>window.__CUTROOM_APP_ORIGIN__=${JSON.stringify(appOrigin)}</script><script src="${base}runtime/bridge.js"></script>`;
        let html = (await handle.readFile('utf8')).replaceAll('cutroom:gsap', `${base}runtime/gsap.min.js`).replaceAll('__CUTROOM_COMP_BASE__', base);
        html = html.includes('</head>') ? html.replace('</head>', `${injection}</head>`) : `${injection}${html}`;
        response.setHeader('Content-Length', Buffer.byteLength(html)); response.end(request.method === 'HEAD' ? undefined : html); return;
      }
      response.setHeader('Content-Length', info.size); if (request.method === 'HEAD' || !info.size) { response.end(); return; }
      await pipeline(handle.createReadStream({ autoClose: false }), response);
    } catch { if (!response.headersSent) fail(404); else response.destroy(); } finally { await handle?.close().catch(() => undefined); }
  };
  const server = createServer((request, response) => { void serve(request, response); }); server.requestTimeout = 30_000; server.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Composition server did not bind');
  boundHost = `127.0.0.1:${address.port}`;
  return { baseUrl: `http://${boundHost}/k/${token}/`, close: () => new Promise<void>((resolve, reject) => { server.close((error) => error ? reject(error) : resolve()); server.closeAllConnections(); }) };
}
