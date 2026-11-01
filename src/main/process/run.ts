import { spawn } from 'node:child_process';

export interface CommandResult { code: number | null; stdout: string }
export type RunCommand = (binary: string, args: readonly string[], options?: { env?: NodeJS.ProcessEnv; signal?: AbortSignal; timeoutMs?: number }) => Promise<CommandResult>;
export const runCommand: RunCommand = async (binary, args, options = {}) => new Promise((resolve, reject) => {
  const signal = AbortSignal.any([AbortSignal.timeout(options.timeoutMs ?? 10_000), ...(options.signal ? [options.signal] : [])]);
  const child = spawn(binary, [...args], { shell: false, env: options.env, signal, killSignal: 'SIGKILL', stdio: ['ignore', 'pipe', 'ignore'] });
  let output = ''; let tooLarge = false;
  child.stdout.on('data', (data: Buffer) => { if (Buffer.byteLength(output) + data.length > 1024 * 1024) { tooLarge = true; child.kill('SIGKILL'); } else output += data.toString('utf8'); });
  child.once('error', () => reject(new Error('The command could not be started or timed out.')));
  child.once('close', (code) => { if (tooLarge || signal.aborted) reject(new Error('The command timed out or produced excessive output.')); else resolve({ code, stdout: output }); });
});
