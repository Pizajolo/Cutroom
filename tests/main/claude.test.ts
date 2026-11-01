import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveClaudeBinary } from '@main/claude/binary';
import { ClaudeCodeService, cleanClaudeEnv, loginAppleScript, parseClaudeStatus } from '@main/claude/service';
import { createClaudeAgentEnv } from '@main/claude/env';
import type { RunCommand } from '@main/process/run';
import type { AccountInfo } from '@shared/schema/accounts';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const authenticated: AccountInfo = { provider: 'anthropic', method: 'claude-code', status: 'connected', detail: null, keyPreview: null, checkedAt: null };
const base = { PATH: '/usr/bin', ANTHROPIC_API_KEY: 'ambient-key', ANTHROPIC_AUTH_TOKEN: 'ambient-auth', CLAUDE_CODE_OAUTH_TOKEN: 'ambient-oauth', CLAUDE_CODE_USE_BEDROCK: '1', CLAUDE_CODE_USE_VERTEX: '1', SAFE: 'keep' };
describe('Claude auth environment', () => {
  it('strips ambient keys/tokens/provider selectors in Claude Code mode', async () => {
    const getApiKey = vi.fn(); const env = await createClaudeAgentEnv({ list: () => [authenticated], getApiKey }, base)();
    expect(env).toEqual({ PATH: '/usr/bin', SAFE: 'keep' }); expect(getApiKey).not.toHaveBeenCalled(); expect(base.ANTHROPIC_API_KEY).toBe('ambient-key');
  });
  it('injects only the Keychain key in API-key mode', async () => {
    const env = await createClaudeAgentEnv({ list: () => [{ ...authenticated, method: 'api-key' }], getApiKey: async () => 'keychain-key' }, base)();
    expect(env).toEqual({ PATH: '/usr/bin', SAFE: 'keep', ANTHROPIC_API_KEY: 'keychain-key' });
  });
  it('forbids use while not connected or if the stored API key is missing', async () => {
    await expect(createClaudeAgentEnv({ list: () => [], getApiKey: vi.fn() }, base)()).rejects.toMatchObject({ code: 'forbidden' });
    await expect(createClaudeAgentEnv({ list: () => [{ ...authenticated, method: 'api-key' }], getApiKey: async () => null }, base)()).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('cleans undefined values and does not mutate process environment', () => { expect(cleanClaudeEnv({ ...base, OMIT: undefined })).toEqual({ PATH: '/usr/bin', SAFE: 'keep' }); });
});
describe('official Claude Code status', () => {
  it('parses observed JSON shape and maps orgName without interpreting tokens', () => {
    expect(parseClaudeStatus(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'person@example.com', orgId: 'opaque-id', orgName: 'Organization', subscriptionType: 'pro' }), 0)).toEqual({ loggedIn: true, authMethod: 'claude.ai', email: 'person@example.com', organization: 'Organization' });
  });
  it('uses exit-code login state and tolerates unknown or missing JSON fields', () => {
    expect(parseClaudeStatus('{"authMethod":"new-method","loggedIn":false}', 0)).toMatchObject({ loggedIn: true, authMethod: 'unknown', email: null });
    expect(parseClaudeStatus('not JSON', 0)).toMatchObject({ loggedIn: true, authMethod: 'unknown' });
    expect(parseClaudeStatus('{"loggedIn":true,"email":"hidden"}', 1)).toMatchObject({ loggedIn: false, authMethod: 'none', email: null });
  });
  it('spawns fixed argument arrays with scrubbed env and gets a separate CLI version', async () => {
    const run = vi.fn<RunCommand>(async (_bin, args) => args[0] === '--version' ? { code: 0, stdout: '2.1.208 (Claude Code)\n' } : { code: 0, stdout: '{"authMethod":"claude.ai"}' });
    const service = new ClaudeCodeService({ resolve: async () => ({ path: '/safe/claude', source: 'sdk-bundled' }), run });
    expect(await service.status()).toMatchObject({ available: true, loggedIn: true, cliVersion: '2.1.208', binarySource: 'sdk-bundled' });
    expect(run.mock.calls.map((call) => call[1])).toEqual([['auth', 'status'], ['--version']]);
    for (const call of run.mock.calls) { expect(call[0]).toBe('/safe/claude'); expect(call[2]?.env).not.toHaveProperty('CLAUDE_CODE_OAUTH_TOKEN'); expect(call[2]?.env).not.toHaveProperty('ANTHROPIC_API_KEY'); }
  });
  it('reports no binary as unavailable without spawning', async () => {
    const run = vi.fn<RunCommand>(); const service = new ClaudeCodeService({ resolve: async () => null, run });
    expect(await service.status()).toMatchObject({ available: false, binarySource: null, loggedIn: false }); expect(run).not.toHaveBeenCalled();
    await expect(service.openLogin()).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('quotes shell paths and AppleScript separately and rejects control characters', async () => {
    const binary = '/Users/Person O\'Brien/"quoted"/claude';
    const script = loginAppleScript(binary);
    expect(script).toContain("'\\\"'\\\"'"); expect(script).toContain('\\"quoted\\"'); expect(script).toContain(' auth login');
    expect(() => loginAppleScript('/safe/claude\nmalicious')).toThrow();
    const run = vi.fn<RunCommand>(async () => ({ code: 0, stdout: '' })); const service = new ClaudeCodeService({ run, resolve: async () => ({ path: binary, source: 'installed' }) });
    await service.openLogin(); expect(run).toHaveBeenCalledWith('/usr/bin/osascript', ['-e', script, '-e', 'tell application "Terminal" to activate'], expect.objectContaining({ timeoutMs: 10_000 }));
  });
  it('resolves SDK first, then only fixed installed candidates, without spawning a shell', async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), 'cutroom-claude-test-'))); roots.push(root);
    const sdk = path.join(root, 'sdk'); await mkdir(sdk); await writeFile(path.join(sdk, 'claude'), 'fixture'); await chmod(path.join(sdk, 'claude'), 0o755);
    const installed = path.join(root, 'installed'); await writeFile(installed, 'fixture'); await chmod(installed, 0o755);
    expect(await resolveClaudeBinary({ arch: 'arm64', resolvePackage: () => path.join(sdk, 'package.json'), installedPaths: [installed] })).toEqual({ path: path.join(sdk, 'claude'), source: 'sdk-bundled' });
    expect(await resolveClaudeBinary({ resolvePackage: () => { throw new Error('absent'); }, installedPaths: [installed] })).toEqual({ path: installed, source: 'installed' });
    expect(await resolveClaudeBinary({ resolvePackage: () => { throw new Error('absent'); }, installedPaths: [] })).toBeNull();
  });
});
