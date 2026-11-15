// The Skill Marketplace: sign in with Google (in the browser), browse, install and update skills, favourite, review,
// report, buy and publish. The device token stays in this process, encrypted on disk; the UI never sees it.
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { hostname } from 'node:os';
import path from 'node:path';
import { app, safeStorage, shell } from 'electron';
import { unzipSync, zipSync } from 'fflate';
import { LIBRARY } from '../cli/project';
import { HOME } from '../cli/run';
import type {
  MarketAccount,
  MarketDetail,
  MarketInstalled,
  MarketOwnSkill,
  MarketPage,
  MarketPublishResult,
  MarketQuery,
  MarketReview,
  MarketSkill,
} from '../shared/types';

/** Installed marketplace skills: a Claude Code plugin like the library, but read-only for the agent. */
export const MARKET = path.join(HOME, 'market');
const SKILLS = path.join(MARKET, 'skills');
const INSTALLED = path.join(MARKET, 'installed.json');
const ACCOUNT = path.join(HOME, 'market.enc');
const DEFAULT_URL = 'https://cutroom.app';

interface Stored {
  url?: string;
  token?: string;
  user?: MarketAccount['user'];
}
interface Installed {
  version: number;
  sha256: string;
  installedAt: string;
}

// --- Account ------------------------------------------------------------------------------------

async function load(): Promise<Stored> {
  try {
    return JSON.parse(safeStorage.decryptString(await readFile(ACCOUNT))) as Stored;
  } catch {
    return {};
  }
}
async function store(next: Stored): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('The system keychain is unavailable, so the sign-in cannot be stored safely.');
  await mkdir(HOME, { recursive: true });
  await writeFile(ACCOUNT, safeStorage.encryptString(JSON.stringify(next)), { mode: 0o600 });
}

/** The marketplace address: Settings, else CUTROOM_MARKET_URL, else the public site. */
const baseUrl = (s: Stored): string => (s.url || process.env.CUTROOM_MARKET_URL || DEFAULT_URL).replace(/\/+$/, '');

export class MarketError extends Error {
  constructor(public status: number, message: string, public details: string[] = []) {
    super(details.length ? `${message}\n${details.map((d) => `• ${d}`).join('\n')}` : message);
  }
}

async function request<T>(route: string, init: RequestInit & { json?: unknown; auth?: boolean } = {}): Promise<T> {
  const saved = await load();
  const { json, auth = true, ...rest } = init;
  const headers: Record<string, string> = { accept: 'application/json', 'user-agent': `Cutroom/${app.getVersion()}` };
  if (json !== undefined) headers['content-type'] = 'application/json';
  if (auth && saved.token) headers.authorization = `Bearer ${saved.token}`;
  let res: Response;
  try {
    res = await fetch(`${baseUrl(saved)}/api/v1${route}`, { ...rest, headers: { ...headers, ...(rest.headers as Record<string, string>) }, body: json !== undefined ? JSON.stringify(json) : rest.body });
  } catch {
    throw new MarketError(0, `Can’t reach the marketplace at ${baseUrl(saved)}.`);
  }
  if (res.status === 401 && saved.token) {
    // The token was revoked (signed out on the web, or the account was blocked).
    await store({ url: saved.url });
    throw new MarketError(401, 'You were signed out of the marketplace. Sign in again.');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; details?: unknown };
    throw new MarketError(res.status, body.error ?? `The marketplace answered ${res.status}.`, Array.isArray(body.details) ? body.details.map(String) : []);
  }
  return (route.endsWith('/download') ? res : await res.json()) as T;
}

export async function account(): Promise<MarketAccount> {
  const saved = await load();
  return { signedIn: !!saved.token, user: saved.user, url: baseUrl(saved) };
}

/** Refresh the profile (role, payouts) from the server. */
export async function refreshAccount(): Promise<MarketAccount> {
  const saved = await load();
  if (!saved.token) return account();
  const user = await request<NonNullable<MarketAccount['user']>>('/me');
  await store({ ...saved, user });
  return account();
}

export async function setServer(url: string): Promise<MarketAccount> {
  const clean = url.trim().replace(/\/+$/, '');
  if (clean && !/^https:\/\/[\w.-]+(:\d+)?$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(clean)) throw new Error('Use an https:// address (http only for localhost).');
  const saved = await load();
  // A token belongs to one server.
  await store(clean === (saved.url ?? '') ? saved : { url: clean || undefined });
  return account();
}

const b64url = (buf: Buffer): string => buf.toString('base64url');

/**
 * Sign in: the browser does Google and the approval; we listen on 127.0.0.1 for the one-time code and trade it,
 * with our PKCE verifier, for a device token. Resolves when done, or after five minutes.
 */
export async function login(): Promise<MarketAccount> {
  const saved = await load();
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const state = b64url(randomBytes(16));

  const code = await new Promise<string>((resolve, reject) => {
    const page = (title: string, text: string): string =>
      `<!doctype html><meta charset="utf-8"><title>Cutroom</title><body style="font:15px -apple-system,sans-serif;display:grid;place-items:center;height:90vh;background:#191c20;color:#e8edf2"><div style="text-align:center"><h1 style="font-size:22px">${title}</h1><p style="color:#9ba7b4">${text}</p></div>`;
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/callback') return void res.writeHead(404).end();
      const ok = url.searchParams.get('state') === state && !!url.searchParams.get('code');
      res.writeHead(ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8' });
      res.end(ok ? page('You’re signed in', 'Go back to Cutroom — you can close this tab.') : page('Sign-in failed', 'Start again from Cutroom.'));
      if (!ok) return;
      clearTimeout(timer);
      server.close();
      resolve(url.searchParams.get('code')!);
    });
    const timer = setTimeout(() => (server.close(), reject(new Error('The sign-in timed out. Try again.'))), 5 * 60_000);
    server.on('error', (e) => (clearTimeout(timer), reject(e)));
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      const query = new URLSearchParams({ port: String(port), state, challenge, device: `Cutroom on ${hostname().replace(/\.local$/, '')}` });
      void shell.openExternal(`${baseUrl(saved)}/desktop/login?${query}`);
    });
  });

  const { token } = await request<{ token: string }>('/desktop/token', { method: 'POST', json: { code, verifier }, auth: false });
  await store({ url: saved.url, token });
  return refreshAccount();
}

export async function logout(): Promise<MarketAccount> {
  const saved = await load();
  if (saved.token) await request('/desktop/logout', { method: 'POST' }).catch(() => {});
  await store({ url: saved.url });
  return account();
}

/** Open a page of the marketplace website (payouts, a skill page, …) in the browser. */
export async function openWeb(route: string): Promise<void> {
  if (!/^\/[\w\-/?=&.]*$/.test(route)) throw new Error('Invalid page.');
  await shell.openExternal(`${baseUrl(await load())}${route}`);
}

// --- Browsing -----------------------------------------------------------------------------------

export function browse(query: MarketQuery): Promise<MarketPage> {
  const params = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]));
  return request<MarketPage>(`/skills?${params}`);
}

export async function detail(slug: string): Promise<MarketDetail> {
  const [skill, { reviews }] = await Promise.all([
    request<MarketDetail>(`/skills/${encodeURIComponent(slug)}`),
    request<{ reviews: MarketReview[] }>(`/skills/${encodeURIComponent(slug)}/reviews`),
  ]);
  return { ...skill, reviews };
}

export const favorites = async (): Promise<MarketSkill[]> => (await request<{ favorites: MarketSkill[] }>('/me/favorites')).favorites;

export async function setFavorite(slug: string, on: boolean): Promise<void> {
  await request(`/skills/${encodeURIComponent(slug)}/favorite`, { method: on ? 'POST' : 'DELETE' });
}

export async function review(slug: string, rating: number, body: string): Promise<MarketReview[]> {
  return (await request<{ reviews: MarketReview[] }>(`/skills/${encodeURIComponent(slug)}/reviews`, { method: 'POST', json: { rating, body } })).reviews;
}

export async function deleteReview(slug: string): Promise<MarketReview[]> {
  return (await request<{ reviews: MarketReview[] }>(`/skills/${encodeURIComponent(slug)}/reviews`, { method: 'DELETE' })).reviews;
}

export async function report(slug: string, reason: string, details: string): Promise<void> {
  await request(`/skills/${encodeURIComponent(slug)}/report`, { method: 'POST', json: { reason, details } });
}

/** Paid skills: Stripe Checkout in the browser. Install once the payment is through. */
export async function buy(slug: string): Promise<void> {
  const { url } = await request<{ url: string }>(`/skills/${encodeURIComponent(slug)}/checkout`, { method: 'POST', json: { from: 'desktop' } });
  if (!/^https:\/\//.test(url)) throw new Error('Unexpected checkout address.');
  await shell.openExternal(url);
}

// --- Installing ---------------------------------------------------------------------------------

const readInstalled = async (): Promise<Record<string, Installed>> => JSON.parse(await readFile(INSTALLED, 'utf8').catch(() => '{}')) as Record<string, Installed>;
const SLUG = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
const ALLOWED = /^(SKILL\.md|example\.(mp4|mov|webm)|references\/[\w\-. ]+\.md|templates\/[\w\-./ @+()]+\.(html|css|js|mjs|json|svg|png|jpe?g|webp|gif|woff2?|ttf|otf|txt|md))$/;

/** The plugin folder Claude Code loads installed skills from. */
export async function ensureMarketPlugin(): Promise<void> {
  await mkdir(path.join(MARKET, '.claude-plugin'), { recursive: true });
  await mkdir(SKILLS, { recursive: true });
  await writeFile(path.join(MARKET, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'market', description: 'Styles and moves installed from the Cutroom Skill Marketplace' }));
}

/** Download a skill and put it in place. The server checked it; we still refuse anything that isn't a plain skill file. */
export async function install(slug: string): Promise<void> {
  if (!SLUG.test(slug)) throw new Error('Invalid skill name.');
  const res = await request<Response>(`/skills/${slug}/download`);
  const zip = new Uint8Array(await res.arrayBuffer());
  const expected = res.headers.get('x-skill-sha256');
  if (expected && createHash('sha256').update(zip).digest('hex') !== expected) throw new Error('The download was damaged. Try again.');
  const files = unzipSync(zip);
  const names = Object.keys(files).filter((n) => !n.endsWith('/'));
  const bad = names.filter((n) => !ALLOWED.test(n) || n.split('/').some((p) => p === '..' || p.startsWith('.')));
  if (bad.length || !names.includes('SKILL.md')) throw new Error(`Refused to install “${slug}”: unexpected files (${bad.join(', ') || 'no SKILL.md'}).`);

  await ensureMarketPlugin();
  const temp = path.join(MARKET, `.tmp-${slug}-${Date.now()}`);
  try {
    for (const name of names) {
      const target = path.join(temp, name);
      if (!target.startsWith(temp + path.sep)) throw new Error('Unsafe path in the bundle.');
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, files[name]!);
    }
    const dest = path.join(SKILLS, slug);
    await rm(dest, { recursive: true, force: true });
    await rename(temp, dest);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
  const installed = await readInstalled();
  installed[slug] = { version: Number(res.headers.get('x-skill-version')) || 0, sha256: expected ?? '', installedAt: new Date().toISOString() };
  await writeFile(INSTALLED, JSON.stringify(installed, null, 2));
}

/** Remove from this Mac; `forget` also removes it from the account's marketplace library. */
export async function uninstall(slug: string, forget = false): Promise<void> {
  if (!SLUG.test(slug)) throw new Error('Invalid skill name.');
  await rm(path.join(SKILLS, slug), { recursive: true, force: true });
  const installed = await readInstalled();
  delete installed[slug];
  await mkdir(MARKET, { recursive: true });
  await writeFile(INSTALLED, JSON.stringify(installed, null, 2));
  if (forget && (await load()).token) await request(`/me/library/${slug}`, { method: 'DELETE' }).catch(() => {});
}

/** What is installed here, joined with the account's library for updates and removed skills. */
export async function installed(): Promise<MarketInstalled[]> {
  const local = await readInstalled();
  const present = existsSync(SKILLS) ? await readdir(SKILLS) : [];
  const remote = (await load()).token
    ? await request<{ library: { skill: MarketSkill; latestVersion: number | null; unavailable?: string }[] }>('/me/library').then((r) => r.library).catch(() => [])
    : [];
  return present
    .filter((slug) => SLUG.test(slug))
    .map((slug) => {
      const entry = remote.find((r) => r.skill.slug === slug);
      const version = local[slug]?.version ?? 0;
      return {
        slug,
        version,
        installedAt: local[slug]?.installedAt ?? '',
        skill: entry?.skill,
        latestVersion: entry?.latestVersion ?? undefined,
        updateAvailable: !!entry?.latestVersion && entry.latestVersion > version && !entry.unavailable,
        removed: entry?.unavailable,
      };
    });
}

/** Installed version per slug, for the library list. */
export async function installedVersions(): Promise<Record<string, number>> {
  return Object.fromEntries(Object.entries(await readInstalled()).map(([slug, i]) => [slug, i.version]));
}

// --- Publishing ---------------------------------------------------------------------------------

/** Zip one of the user's own styles or moves the way the marketplace expects it. */
async function bundle(name: string): Promise<Uint8Array> {
  const dir = path.join(LIBRARY, 'skills', name);
  if (!/^[\w-]+$/.test(name) || !existsSync(path.join(dir, 'SKILL.md'))) throw new Error(`No style or move called “${name}” in your library.`);
  const files: Record<string, Uint8Array> = {};
  const walk = async (rel: string): Promise<void> => {
    for (const entry of await readdir(path.join(dir, rel), { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const file = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile() && ALLOWED.test(file)) files[file] = new Uint8Array(await readFile(path.join(dir, file)));
    }
  };
  await walk('');
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, [v, { level: k.startsWith('example.') ? 0 : 6 }]])));
}

/** Publish `my:<name>` (a new skill, or a new version of one you published). */
export async function publish(id: string, options: { priceCents?: number; changelog?: string }): Promise<MarketPublishResult> {
  const name = /^my:([\w-]+)$/.exec(id)?.[1];
  if (!name) throw new Error('Only your own styles and moves can be published.');
  const form = new FormData();
  form.set('bundle', new Blob([(await bundle(name)) as Uint8Array<ArrayBuffer>], { type: 'application/zip' }), `${name}.zip`);
  if (options.priceCents !== undefined) form.set('price', String(options.priceCents));
  if (options.changelog) form.set('changelog', options.changelog);
  return request<MarketPublishResult>('/skills', { method: 'POST', body: form });
}

export const mine = async (): Promise<MarketOwnSkill[]> => (await request<{ skills: MarketOwnSkill[] }>('/me/skills')).skills;

export async function updateOwn(slug: string, patch: { price?: number; listed?: boolean }): Promise<void> {
  await request(`/skills/${encodeURIComponent(slug)}`, { method: 'PATCH', json: patch });
}

/** `media://marketplace/<slug>`: the skill's example video, fetched by the main process so the renderer's CSP stays closed. */
export async function proxyExample(slug: string, incoming: Request): Promise<Response> {
  if (!SLUG.test(slug)) return new Response(null, { status: 404 });
  const saved = await load();
  const headers: Record<string, string> = {};
  const range = incoming.headers.get('range');
  if (range) headers.range = range;
  if (saved.token) headers.authorization = `Bearer ${saved.token}`;
  try {
    const res = await fetch(`${baseUrl(saved)}/api/v1/skills/${slug}/example`, { headers });
    const pass = ['content-type', 'content-length', 'content-range', 'accept-ranges'];
    return new Response(res.body, { status: res.status, headers: Object.fromEntries(pass.flatMap((h) => (res.headers.get(h) ? [[h, res.headers.get(h)!]] : []))) });
  } catch {
    return new Response(null, { status: 502 });
  }
}
