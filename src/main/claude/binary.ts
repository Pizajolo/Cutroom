import { constants } from 'node:fs';
import { access, lstat, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { contained } from '../tools/files';

export interface ClaudeBinary { path: string; source: 'sdk-bundled' | 'installed' }
const require = createRequire(import.meta.url);
export async function resolveClaudeBinary(options: { arch?: string; home?: string; resolvePackage?: (name: string) => string; installedPaths?: readonly string[] } = {}): Promise<ClaudeBinary | null> {
  const arch = options.arch ?? process.arch; const home = options.home ?? homedir();
  const usable = async (file: string): Promise<string | null> => {
    if ([...file].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return null;
    try { const canonical = await realpath(file); if ([...canonical].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || !(await stat(canonical)).isFile()) return null; await access(canonical, constants.X_OK); return canonical; } catch { return null; }
  };
  if (arch === 'arm64' || arch === 'x64') {
    try {
      const metadata = (options.resolvePackage ?? ((name) => require.resolve(name)))(`@anthropic-ai/claude-agent-sdk-darwin-${arch}/package.json`);
      const root = path.dirname(metadata).replace(/\.asar\//, '.asar.unpacked/');
      const canonicalRoot = await realpath(root);
      const candidate = path.join(root, 'claude'); const info = await lstat(candidate);
      const binary = info.isFile() && (info.mode & 0o111) !== 0 ? await usable(candidate) : null;
      if (binary && contained(canonicalRoot, binary)) return { path: binary, source: 'sdk-bundled' };
    } catch { /* Optional native SDK absent: try the fixed installed locations only. */ }
  }
  for (const file of options.installedPaths ?? [path.join(home, '.local/bin/claude'), path.join(home, '.claude/local/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude']) {
    const binary = await usable(file); if (binary) return { path: binary, source: 'installed' };
  }
  return null;
}
