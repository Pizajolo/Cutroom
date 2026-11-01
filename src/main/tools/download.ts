import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';

export interface DownloadPolicy { allowedHosts: readonly string[]; allowedHostSuffixes?: readonly string[] }
export type Fetch = typeof fetch;
export class DownloadFailure extends Error {}
export function approvedUrl(value: string, policy: DownloadPolicy): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !(policy.allowedHosts.includes(url.hostname) || policy.allowedHostSuffixes?.some((suffix) => url.hostname.endsWith(suffix)))) throw new DownloadFailure('The download redirected to an unapproved host.');
  return url;
}
export async function download(options: {
  url: string; file: string; policy: DownloadPolicy; limit: number; signal: AbortSignal;
  fetch?: Fetch; onProgress?: (received: number, total: number | null) => void; inactivityMs?: number;
}): Promise<{ sha256: string; size: number }> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const reset = (): void => { clearTimeout(timer); timer = setTimeout(() => controller.abort(), options.inactivityMs ?? 30_000); timer.unref(); };
  const signal = AbortSignal.any([options.signal, controller.signal]);
  reset();
  try {
    let url = approvedUrl(options.url, options.policy);
    let response: Response | undefined;
    for (let redirects = 0; redirects <= 5; redirects++) {
      signal.throwIfAborted();
      response = await (options.fetch ?? fetch)(url, { redirect: 'manual', signal, headers: { 'User-Agent': 'Cutroom/0.1' } });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('location'); await response.body?.cancel();
      if (!location || redirects === 5) throw new DownloadFailure('Too many download redirects.');
      url = approvedUrl(new URL(location, url).href, options.policy); reset();
    }
    if (!response?.ok || !response.body) throw new DownloadFailure(`Download failed (HTTP ${response?.status ?? 'unknown'}).`);
    const length = response.headers.get('content-length');
    const total = length !== null && /^\d+$/.test(length) && Number.isSafeInteger(Number(length)) && Number(length) > 0 ? Number(length) : null;
    if (total !== null && total > options.limit) { await response.body.cancel(); throw new DownloadFailure('Download exceeds the allowed size.'); }
    const file = await open(options.file, 'wx', 0o600);
    const reader = response.body.getReader(); const hash = createHash('sha256'); let received = 0;
    const abort = (): void => { void reader.cancel().catch(() => undefined); };
    signal.addEventListener('abort', abort, { once: true });
    try {
      options.onProgress?.(0, total);
      while (true) {
        signal.throwIfAborted();
        const chunk = await reader.read(); signal.throwIfAborted();
        if (chunk.done) break;
        reset(); received += chunk.value.byteLength;
        if (received > options.limit) throw new DownloadFailure('Download exceeds the allowed size.');
        hash.update(chunk.value); await file.writeFile(chunk.value); options.onProgress?.(received, total);
      }
      if (total !== null && total !== received) throw new DownloadFailure('Download was incomplete.');
      await file.sync(); return { sha256: hash.digest('hex'), size: received };
    } finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => undefined); reader.releaseLock(); await file.close(); }
  } catch (error) {
    if (options.signal.aborted) throw new DownloadFailure('Download cancelled.');
    if (controller.signal.aborted) throw new DownloadFailure('Download timed out. Check your connection and retry.');
    if (error instanceof DownloadFailure) throw error;
    throw new DownloadFailure('Download failed. Check your connection and retry.');
  } finally { clearTimeout(timer!); }
}
export function checksumFromText(text: string, format: 'single' | 'sums', entry?: string): string {
  if (format === 'single') {
    const match = /^([a-f0-9]{64})(?:[ \t]+\*?[^\r\n]+)?$/i.exec(text.trim());
    if (match?.[1]) return match[1].toLowerCase();
  } else {
    const matches = text.split(/\r?\n/).flatMap((line) => {
      const match = /^([a-f0-9]{64})[ \t]+\*?(.+?)\s*$/i.exec(line);
      return match && match[2] === entry && match[1] ? [match[1].toLowerCase()] : [];
    });
    if (matches.length === 1 && matches[0]) return matches[0];
  }
  throw new DownloadFailure('The upstream checksum is missing or invalid.');
}
