import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { cleanCodexEnv, CodexService, codexExecArgs, codexLoginAppleScript } from '@main/codex/service';
import { resolveCodexBinary } from '@main/codex/binary';
import type { RunCommand } from '@main/process/run';

vi.mock('node:fs/promises', async (importOriginal) => { const actual = await importOriginal<typeof import('node:fs/promises')>(); return { ...actual, open: vi.fn(actual.open), readFile: vi.fn(actual.readFile) }; });
const roots: string[] = [];
async function temporary() { const root = await fs.mkdtemp(path.join(process.env.TMPDIR ?? tmpdir(), 'cutroom-codex-test-')); roots.push(root); return root; }
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

describe('official Codex CLI delegation', () => {
  it('checks only fixed executables and never reads Codex auth files', async () => {
    const open = vi.mocked(fs.open); const read = vi.mocked(fs.readFile); const status = await new CodexService({ resolve: async () => null }).status(); expect(status).toEqual({ available: false, loggedIn: false, mode: null }); expect(await resolveCodexBinary(['/nonexistent/codex'])).toBeNull();
    expect([...open.mock.calls, ...read.mock.calls].some(([file]) => String(file).includes('.codex/auth.json'))).toBe(false);
  });
  it.each([0, 1])('interprets login status exit %s without persisting output', async (code) => {
    const service = new CodexService({ resolve: async () => '/fixed/codex', run: async (_binary, args, options) => {
      if (args[0] === '--version') return { code: 0, stdout: 'codex-cli 0.100.0\n' }; options?.onStderr?.('Logged in using ChatGPT\n'); return { code, stdout: '' };
    } }); expect(await service.status()).toEqual({ available: true, version: '0.100.0', loggedIn: code === 0, mode: code === 0 ? 'chatgpt' : null });
  });
  it('uses a read-only ephemeral args array and removes output after success and abort', async () => {
    const root = await temporary(); const calls: readonly string[][] = []; const recorded = calls as string[][]; let abort = false;
    const run: RunCommand = async (_binary, args, options) => {
      recorded.push([...args]); if (args[0] === '--version') return { code: 0, stdout: 'codex 0.100.0' }; if (args[0] === 'login') return { code: 0, stdout: 'Logged in using ChatGPT' };
      if (abort) { await new Promise<void>((resolve) => options?.signal?.addEventListener('abort', () => resolve(), { once: true })); throw new Error('Aborted'); }
      await fs.writeFile(args[args.indexOf('-o') + 1]!, 'Read-only analysis'); return { code: 0, stdout: '' };
    };
    const service = new CodexService({ resolve: async () => '/fixed/codex', run }); const prompt = 'Inspect this; $(do not execute)'; expect(await service.task(root, { prompt, model: 'model-id' })).toBe('Read-only analysis');
    const args = recorded.find((args) => args[0] === 'exec')!; expect(args).toEqual(codexExecArgs(root, args[args.indexOf('-o') + 1]!, prompt, 'model-id')); expect(args.slice(-2)).toEqual(['--', prompt]); expect(args).toContain('--ephemeral'); expect(args[args.indexOf('--sandbox') + 1]).toBe('read-only'); expect(await fs.readdir(path.join(root, 'work/codex'))).toEqual([]);
    abort = true; const controller = new AbortController(); const pending = service.task(root, { prompt: 'Inspect' }, controller.signal); setTimeout(() => controller.abort(), 50); await expect(pending).rejects.toThrow(); expect(await fs.readdir(path.join(root, 'work/codex'))).toEqual([]);
  });
  it('strips ambient credentials and launches only the unmodified official login command', () => {
    expect(cleanCodexEnv({ HOME: '/home', OPENAI_API_KEY: 'secret', CODEX_HOME: '/foreign', ANTHROPIC_API_KEY: 'secret', NODE_OPTIONS: 'loader' })).toEqual({ HOME: '/home', PATH: '/usr/bin:/bin:/usr/sbin:/sbin' });
    expect(codexLoginAppleScript('/fixed/codex')).toContain("'/fixed/codex' login"); expect(() => codexLoginAppleScript('codex')).toThrow();
  });
});
