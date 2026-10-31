import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { appResponse } from '@main/protocol';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'cutroom-protocol-test-'));
  await writeFile(path.join(root, 'index.html'), '<title>Cutroom</title>');
});
afterEach(async () => { await rm(root, { recursive: true }); });

describe('privileged app protocol', () => {
  it('serves the app with CSP and no unsafe-eval', async () => {
    const response = await appResponse(new Request('app://cutroom/'), root);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(response.headers.get('content-security-policy')).not.toContain('unsafe-eval');
    expect(await response.text()).toContain('Cutroom');
  });
  it('denies other hosts and non-read methods', async () => {
    expect((await appResponse(new Request('app://evil/'), root)).status).toBe(403);
    expect((await appResponse(new Request('app://cutroom/', { method: 'POST' }), root)).status).toBe(405);
  });
  it('denies symlink escapes', async () => {
    await symlink(path.dirname(root), path.join(root, 'escape'));
    expect((await appResponse(new Request('app://cutroom/escape/'), root)).status).toBe(403);
  });
  it('sets CSP on missing resources as well', async () => {
    const response = await appResponse(new Request('app://cutroom/missing'), root);
    expect(response.status).toBe(404); expect(response.headers.get('content-security-policy')).not.toBeNull();
  });
});
