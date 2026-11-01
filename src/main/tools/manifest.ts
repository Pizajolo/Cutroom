import { readFile } from 'node:fs/promises';

export interface ToolPin {
  name: string;
  version: string;
  arch: 'arm64' | 'x64';
  bundled: boolean;
  sourceUrl: string;
  checksumUrl: string;
  archiveSha256: string | null;
  sha256: string | null;
}
export interface ToolsManifest { schemaVersion: 1; tools: ToolPin[] }
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = (value: unknown): value is string | null => value === null || (typeof value === 'string' && /^[a-f0-9]{64}$/.test(value));
export function parseManifest(value: unknown): ToolsManifest {
  if (!record(value) || value.schemaVersion !== 1 || !Array.isArray(value.tools)) throw new Error('Invalid tools manifest');
  const seen = new Set<string>();
  const tools = value.tools.map((entry: unknown): ToolPin => {
    if (!record(entry) || typeof entry.name !== 'string' || !/^[a-z][a-z0-9-]*$/.test(entry.name) || typeof entry.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(entry.version) || (entry.arch !== 'arm64' && entry.arch !== 'x64') || typeof entry.sourceUrl !== 'string' || typeof entry.checksumUrl !== 'string' || !digest(entry.archiveSha256) || !digest(entry.sha256)) throw new Error('Invalid tool pin');
    if (new URL(entry.sourceUrl).protocol !== 'https:' || new URL(entry.checksumUrl).protocol !== 'https:') throw new Error('Tool sources must use HTTPS');
    const key = `${entry.name}/${entry.version}/${entry.arch}`;
    if (seen.has(key)) throw new Error('Duplicate tool pin');
    seen.add(key);
    return { name: entry.name, version: entry.version, arch: entry.arch, bundled: entry.bundled !== false, sourceUrl: entry.sourceUrl, checksumUrl: entry.checksumUrl, archiveSha256: entry.archiveSha256, sha256: entry.sha256 };
  });
  return { schemaVersion: 1, tools };
}
export async function readManifest(file: string): Promise<ToolsManifest> {
  return parseManifest(JSON.parse(await readFile(file, 'utf8')) as unknown);
}
export function compareVersions(left: string, right: string): number {
  const a = left.split('.').map(Number); const b = right.split('.').map(Number);
  for (let i = 0; i < 3; i++) { const difference = (a[i] ?? 0) - (b[i] ?? 0); if (difference) return difference; }
  return 0;
}
