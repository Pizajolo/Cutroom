import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { z } from 'zod/v3';

const dependencies = z.record(z.string());
const manifestSchema = z.object({ dependencies, devDependencies: dependencies });
const lockSchema = z.object({
  lockfileVersion: z.literal(3),
  packages: z.record(z.object({
    version: z.string().optional(), dependencies: dependencies.optional(), devDependencies: dependencies.optional(),
    resolved: z.string().url().optional(), integrity: z.string().optional(),
  }).passthrough()),
});
async function dependencyFiles(): Promise<{ manifest: z.infer<typeof manifestSchema>; lock: z.infer<typeof lockSchema> }> {
  const [manifest, lock] = await Promise.all(['package.json', 'package-lock.json'].map((name) => readFile(new URL(`../../${name}`, import.meta.url), 'utf8')));
  return { manifest: manifestSchema.parse(JSON.parse(manifest!)), lock: lockSchema.parse(JSON.parse(lock!)) };
}

describe('npm dependency lock', () => {
  it('keeps the generated lock root in sync with the dependency manifest', async () => {
    const { manifest, lock } = await dependencyFiles();
    expect(lock.packages['']?.dependencies).toEqual(manifest.dependencies);
    expect(lock.packages['']?.devDependencies).toEqual(manifest.devDependencies);
  });
  it.each(['@anthropic-ai/claude-agent-sdk', '@napi-rs/keyring', '@testing-library/dom', 'remotion', '@remotion/bundler', '@remotion/renderer', '@remotion/zod-types', 'hyperframes', 'gsap'])('records a resolved version and integrity for %s', async (name) => {
    const { manifest, lock } = await dependencyFiles(); const entry = lock.packages[`node_modules/${name}`];
    expect(entry?.version).toBe(manifest.dependencies[name] ?? manifest.devDependencies[name]);
    expect(entry?.resolved).toMatch(/^https:\/\/registry\.npmjs\.org\//);
    expect(entry?.integrity).toMatch(/^sha512-[A-Za-z0-9+/]+=*$/);
  });
});
