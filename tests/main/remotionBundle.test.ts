import { expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { bundleRemotion } from '@main/render/remotionBundle';

it('bundles an actual local Remotion template with installed dependencies and a local-only resource CSP', async () => {
  const root = await mkdtemp(path.join(process.env.TMPDIR ?? tmpdir(), 'cutroom-remotion-bundle-'));
  try {
    const source = path.join(root, 'source'); await mkdir(source); const entry = path.join(source, 'index.tsx');
    await writeFile(entry, `import React from 'react'; import {Composition, registerRoot} from 'remotion'; const Title=()=> <div>Hello</div>; registerRoot(()=> <Composition id="Title" component={Title} durationInFrames={30} fps={30} width={320} height={180}/>);`);
    const output = await bundleRemotion(entry, path.join(root, 'bundle')); const html = await readFile(path.join(output, 'index.html'), 'utf8'); expect(html).toContain('Content-Security-Policy'); expect(html).toContain("connect-src 'self'"); expect(html).not.toContain('api-key');
  } finally { await rm(root, { recursive: true, force: true }); }
}, 60_000);
it.each(['outside', 'inline-loader'])('refuses %s imports using the real webpack resolver', async (kind) => {
  const root = await mkdtemp(path.join(process.env.TMPDIR ?? tmpdir(), 'cutroom-remotion-boundary-'));
  try {
    const source = path.join(root, 'source'); await mkdir(source); await writeFile(path.join(root, 'secret.json'), '{"secret":"not-for-the-bundle"}'); const entry = path.join(source, 'index.tsx');
    await writeFile(entry, kind === 'outside' ? `import secret from '../secret.json'; console.log(secret);` : `import value from '!!raw-loader!../secret.json'; console.log(value);`);
    await expect(bundleRemotion(entry, path.join(root, 'bundle'))).rejects.toThrow(); expect(await readFile(path.join(root, 'secret.json'), 'utf8')).toBe('{"secret":"not-for-the-bundle"}');
  } finally { await rm(root, { recursive: true, force: true }); }
}, 60_000);
