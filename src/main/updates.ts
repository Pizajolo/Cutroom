// Updates: Cutroom's releases are published on GitHub. At start the app asks for the latest one
// and offers it when its tag (e.g. v0.3.0) is higher than this build's version.
import { app, shell } from 'electron';
import type { Update } from '../shared/types';

const LATEST = 'https://api.github.com/repos/Pizajolo/Cutroom/releases/latest';

/** 'v1.2.3' → [1, 2, 3] */
const parts = (version: string): number[] => version.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
const newer = (a: string, b: string): boolean => {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
};

/** Release notes as plain markdown the popup can show: no images or badges, links as their text, bullets as dots. */
const notes = (body: string): string =>
  body
    .split(/\r?\n/)
    .filter((line) => !/^\s*(\[?!\[|<img|-{3,}\s*$)/.test(line))
    .map((line) => line.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/^#{4,6} /, '### ').replace(/^(\s*)[-*] /, '$1• '))
    .join('\n')
    .trim();

let found: Update | null = null;

/** The latest release if it is newer than this build; null when up to date, offline or nothing is published. */
export async function checkUpdate(): Promise<Update | null> {
  try {
    const res = await fetch(LATEST, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'Cutroom' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const release = (await res.json()) as { tag_name: string; body?: string; html_url: string; assets?: { name: string; browser_download_url: string }[] };
    if (!newer(release.tag_name, app.getVersion())) return null;
    // Prefer the installer for this Mac; without one, the release page.
    const dmgs = (release.assets ?? []).filter((asset) => asset.name.endsWith('.dmg'));
    const dmg = dmgs.find((asset) => asset.name.includes(process.arch)) ?? dmgs[0];
    found = { version: release.tag_name.replace(/^v/, ''), current: app.getVersion(), notes: notes(release.body ?? ''), url: dmg?.browser_download_url ?? release.html_url };
    return found;
  } catch {
    return null;
  }
}

/** Open the download of the update found by `checkUpdate` in the browser. */
export async function downloadUpdate(): Promise<void> {
  if (found) await shell.openExternal(found.url);
}
