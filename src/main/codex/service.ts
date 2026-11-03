import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { IpcFailure } from '@shared/ipc/errors';
import type { InvokeRes } from '@shared/ipc/contract';
import { managedPath, readManaged } from '../fs/managed';
import { runCommand, type RunCommand } from '../process/run';
import { resolveCodexBinary } from './binary';

export function cleanCodexEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' };
  for (const name of ['HOME', 'USER', 'LOGNAME', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM']) if (base[name]) result[name] = base[name];
  return result;
}
export function codexLoginAppleScript(binary: string): string {
  if (!path.isAbsolute(binary) || [...binary].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) throw new IpcFailure({ code: 'forbidden', message: 'The Codex executable path is not safe to launch.' });
  const command = `'${binary.replaceAll("'", "'\"'\"'")}' login`;
  return `tell application "Terminal" to do script "${command.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}
export function codexExecArgs(root: string, output: string, prompt: string, model?: string): string[] {
  return ['exec', '--json', '--sandbox', 'read-only', '--skip-git-repo-check', '--ephemeral', '-C', root, ...(model ? ['-m', model] : []), '-o', output, '--', prompt];
}
export class CodexService {
  private readonly run: RunCommand; private readonly resolve: () => Promise<string | null>;
  constructor(options: { run?: RunCommand; resolve?: () => Promise<string | null> } = {}) { this.run = options.run ?? runCommand; this.resolve = options.resolve ?? resolveCodexBinary; }
  async status(): Promise<InvokeRes<'accounts.codex.status'>> {
    const binary = await this.resolve(); if (!binary) return { available: false, loggedIn: false, mode: null };
    try {
      let stderr = ''; const env = cleanCodexEnv();
      const [login, version] = await Promise.all([this.run(binary, ['login', 'status'], { env, timeoutMs: 10_000, maxOutputBytes: 32_768, onStderr: (chunk) => { stderr = (stderr + chunk).slice(-32_768); } }), this.run(binary, ['--version'], { env, timeoutMs: 10_000, maxOutputBytes: 4096 })]);
      const text = `${login.stdout}\n${stderr}`; const loggedIn = login.code === 0;
      return { available: true, loggedIn, mode: !loggedIn ? null : /chatgpt/i.test(text) ? 'chatgpt' : /api[ -]?key/i.test(text) ? 'api-key' : null, ...(version.code === 0 && /\d+\.\d+\.\d+/.test(version.stdout) ? { version: /\d+\.\d+\.\d+(?:[-+][\w.-]+)?/.exec(version.stdout)![0] } : {}) };
    } catch { throw new IpcFailure({ code: 'unavailable', message: 'Could not check Codex sign-in. Your saved connection has not been changed.' }); }
  }
  async openLogin(): Promise<{ ok: true }> {
    const binary = await this.resolve(); if (!binary) throw new IpcFailure({ code: 'unavailable', message: 'Codex CLI not found. Install the official Codex CLI and check again.' });
    try { const result = await this.run('/usr/bin/osascript', ['-e', codexLoginAppleScript(binary), '-e', 'tell application "Terminal" to activate'], { env: cleanCodexEnv(), timeoutMs: 10_000 }); if (result.code !== 0) throw new Error('Terminal unavailable'); }
    catch { throw new IpcFailure({ code: 'unavailable', message: 'Could not open Terminal. Run codex login in Terminal yourself, then check sign-in again.' }); }
    return { ok: true };
  }
  async task(root: string, request: { prompt: string; model?: string }, signal?: AbortSignal): Promise<string> {
    const binary = await this.resolve(); if (!binary) throw new IpcFailure({ code: 'unavailable', message: 'Codex CLI not found.' });
    if (!(await this.status()).loggedIn) throw new IpcFailure({ code: 'unavailable', message: 'Sign in to Codex in Accounts first.' });
    const base = await managedPath(root, 'work/codex'); await mkdir(base, { recursive: true, mode: 0o700 }); const temporary = await mkdtemp(path.join(base, 'task-'));
    try {
      const output = path.join(temporary, 'answer.txt'); let bytes = 0;
      const result = await this.run(binary, codexExecArgs(root, output, request.prompt, request.model), { cwd: root, env: cleanCodexEnv(), timeoutMs: 10 * 60_000, signal, onStdout: (chunk) => { bytes += Buffer.byteLength(chunk); if (bytes > 8 * 1024 * 1024) throw new Error('Output limit'); } });
      if (signal?.aborted) throw new IpcFailure({ code: 'conflict', message: 'Codex task interrupted.' });
      if (result.code !== 0) throw new IpcFailure({ code: 'unavailable', message: 'Codex could not complete this read-only task.' });
      return await readManaged(temporary, 'answer.txt', 2 * 1024 * 1024);
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }
}
