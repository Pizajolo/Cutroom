import { constants } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export async function resolveCodexBinary(paths: readonly string[] = [path.join(homedir(), '.local/bin/codex'), '/opt/homebrew/bin/codex', '/usr/local/bin/codex', path.join(homedir(), '.npm-global/bin/codex')]): Promise<string | null> {
  for (const file of paths) {
    if (!path.isAbsolute(file) || [...file].some((char) => char.charCodeAt(0) < 32)) continue;
    try { const canonical = await realpath(file); if ([...canonical].some((char) => char.charCodeAt(0) < 32) || !(await stat(canonical)).isFile()) continue; await access(canonical, constants.X_OK); return canonical; } catch { /* Only fixed locations; never search PATH. */ }
  }
  return null;
}
