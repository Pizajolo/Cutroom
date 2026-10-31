import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

export const APP_CSP = [
  "default-src 'none'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:", "font-src 'self'", "media-src 'self' blob:",
  "connect-src 'self'", "frame-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
].join('; ');
const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

export async function appResponse(request: Request, rendererRoot: string): Promise<Response> {
  const headers = { 'Content-Security-Policy': APP_CSP, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' };
  if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers });
  const url = new URL(request.url);
  if (url.protocol !== 'app:' || url.hostname !== 'cutroom' || url.port || url.username || url.password) return new Response(null, { status: 403, headers });
  try {
    const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname).slice(1);
    if (relative.includes('\0') || relative.includes('\\') || relative.split('/').some((part) => part === '..')) return new Response(null, { status: 403, headers });
    const root = await realpath(rendererRoot); const target = await realpath(path.resolve(root, relative));
    const rel = path.relative(root, target);
    if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return new Response(null, { status: 403, headers });
    const bytes = await readFile(target);
    return new Response(request.method === 'HEAD' ? null : new Uint8Array(bytes), { headers: { ...headers, 'Content-Type': mime[path.extname(target)] ?? 'application/octet-stream' } });
  } catch { return new Response(null, { status: 404, headers }); }
}
