import { spawn } from 'node:child_process';

export interface CommandResult { code: number | null; stdout: string }
export interface CommandOptions {
  env?: NodeJS.ProcessEnv; signal?: AbortSignal; timeoutMs?: number; cwd?: string;
  onStdout?: (chunk: string) => void; onStderr?: (chunk: string) => void; maxOutputBytes?: number;
}
export type RunCommand = (binary: string, args: readonly string[], options?: CommandOptions) => Promise<CommandResult>;
export const runCommand: RunCommand = async (binary, args, options = {}) => new Promise((resolve, reject) => {
  const signal = AbortSignal.any([AbortSignal.timeout(options.timeoutMs ?? 10_000), ...(options.signal ? [options.signal] : [])]);
  if (signal.aborted) { reject(new Error('The command was cancelled before it started.')); return; }
  const child = spawn(binary, [...args], { shell: false, env: options.env, cwd: options.cwd, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; let stopped = false; let settled = false; let killTimer: ReturnType<typeof setTimeout> | undefined;
  const kill = (): void => { if (stopped || settled) return; stopped = true; try { if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM'); else child.kill('SIGTERM'); } catch { /* Already stopped. */ }
    killTimer = setTimeout(() => { try { if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { /* Already stopped. */ } }, 1500); killTimer.unref();
  };
  signal.addEventListener('abort', kill, { once: true }); if (signal.aborted) kill();
  child.stdout.on('data', (data: Buffer) => {
    if (stopped) return;
    if (options.onStdout) { try { options.onStdout(data.toString('utf8')); } catch { kill(); } }
    else if (Buffer.byteLength(output) + data.length > (options.maxOutputBytes ?? 1024 * 1024)) kill();
    else output += data.toString('utf8');
  });
  child.stderr.on('data', (data: Buffer) => { if (!stopped) { try { options.onStderr?.(data.toString('utf8')); } catch { kill(); } } });
  const finish = (error?: Error, code: number | null = null): void => {
    if (settled) return; settled = true; signal.removeEventListener('abort', kill); if (killTimer) clearTimeout(killTimer);
    if (error || stopped || signal.aborted) reject(new Error('The command could not be started, was cancelled, timed out or produced excessive output.'));
    else resolve({ code, stdout: output });
  };
  child.once('error', (error) => finish(error)); child.once('close', (code) => finish(undefined, code));
});
