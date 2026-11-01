import { z } from 'zod/v3';
import { IpcFailure } from '@shared/ipc/errors';
import type { ClaudeCodeStatus } from '@shared/schema/accounts';
import { runCommand, type RunCommand } from '../process/run';
import { resolveClaudeBinary, type ClaudeBinary } from './binary';

export function cleanClaudeEnv(base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  return Object.fromEntries(Object.entries(base).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && !['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'].includes(entry[0]) && !entry[0].startsWith('CLAUDE_CODE_USE_')));
}
const statusSchema = z.object({ authMethod: z.string().optional(), email: z.string().max(320).nullish(), organization: z.string().max(512).nullish(), orgName: z.string().max(512).nullish() }).passthrough();
const methods = new Set<ClaudeCodeStatus['authMethod']>(['none', 'claude.ai', 'oauth_token', 'api_key', 'api_key_helper', 'third_party', 'unknown']);
export function parseClaudeStatus(stdout: string, exitCode: number | null): Pick<ClaudeCodeStatus, 'loggedIn' | 'authMethod' | 'email' | 'organization'> {
  let parsed: z.infer<typeof statusSchema> | null = null;
  try { const result = statusSchema.safeParse(JSON.parse(stdout)); if (result.success) parsed = result.data; } catch { /* Old CLIs may not return JSON. Exit status remains authoritative. */ }
  const loggedIn = exitCode === 0;
  const authMethod = parsed?.authMethod && methods.has(parsed.authMethod as ClaudeCodeStatus['authMethod']) ? parsed.authMethod as ClaudeCodeStatus['authMethod'] : loggedIn ? 'unknown' : 'none';
  return { loggedIn, authMethod, email: loggedIn ? parsed?.email ?? null : null, organization: loggedIn ? parsed?.organization ?? parsed?.orgName ?? null : null };
}
export function loginAppleScript(binary: string): string {
  if (!binary.startsWith('/') || [...binary].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) throw new IpcFailure({ code: 'forbidden', message: 'The Claude executable path is not safe to launch.' });
  const quoted = `'${binary.replaceAll("'", "'\"'\"'")}' auth login`;
  return `tell application "Terminal" to do script "${quoted.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}
export class ClaudeCodeService {
  private readonly run: RunCommand;
  private readonly resolve: () => Promise<ClaudeBinary | null>;
  constructor(options: { run?: RunCommand; resolve?: () => Promise<ClaudeBinary | null> } = {}) { this.run = options.run ?? runCommand; this.resolve = options.resolve ?? resolveClaudeBinary; }
  async status(): Promise<ClaudeCodeStatus> {
    const binary = await this.resolve();
    const absent: ClaudeCodeStatus = { available: false, loggedIn: false, authMethod: 'none', email: null, organization: null, cliVersion: null, binarySource: null };
    if (!binary) return absent;
    const base = { ...absent, available: true, binarySource: binary.source };
    try {
      const env = cleanClaudeEnv();
      const [auth, version] = await Promise.all([this.run(binary.path, ['auth', 'status'], { env, timeoutMs: 10_000 }), this.run(binary.path, ['--version'], { env, timeoutMs: 10_000 }).catch(() => ({ code: 1, stdout: '' }))]);
      const cliVersion = version.code === 0 ? /^([\w.+-]+)(?:\s|$)/.exec(version.stdout.trim())?.[1] ?? null : null;
      return { ...base, ...parseClaudeStatus(auth.stdout, auth.code), cliVersion };
    } catch { return { ...base, authMethod: 'unknown' }; }
  }
  async openLogin(): Promise<void> {
    const binary = await this.resolve();
    if (!binary) throw new IpcFailure({ code: 'unavailable', message: 'Claude Code is not installed. Run npm install or install the official Claude Code CLI, then check again.' });
    try {
      const result = await this.run('/usr/bin/osascript', ['-e', loginAppleScript(binary.path), '-e', 'tell application "Terminal" to activate'], { env: cleanClaudeEnv(), timeoutMs: 10_000 });
      if (result.code !== 0) throw new Error('Login could not be opened.');
    } catch { throw new IpcFailure({ code: 'unavailable', message: 'Could not open Terminal. Open Terminal yourself and run claude auth login, then check again.' }); }
  }
}
