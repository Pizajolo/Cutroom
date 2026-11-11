import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';

/** Where Cutroom keeps binaries, models and the user's skill library. */
export const HOME = process.env.CUTROOM_HOME ?? path.join(homedir(), '.cutroom');

/** Run a command, resolve with its stdout, reject with the tail of stderr on failure. */
export function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; signal?: AbortSignal; env?: NodeJS.ProcessEnv } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err = (err + d).slice(-4000)));
    child.on('error', (e) =>
      reject(new Error(`Could not run ${cmd}: ${e.message}`, { cause: e })),
    );
    child.on('close', (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${cmd} failed (${code}):\n${err.trim()}`)),
    );
  });
}
