import { build } from 'vite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function withToolRuntime(action) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const temp = await mkdtemp(path.join(tmpdir(), 'cutroom-tool-runtime-'));
  try {
    const entry = path.join(root, 'src/main/tools/scriptExports.ts');
    await build({ configFile: false, logLevel: 'error', ssr: { noExternal: true }, resolve: { alias: { '@shared': path.join(root, 'src/shared') } }, build: { ssr: entry, outDir: temp, emptyOutDir: false, lib: { entry, formats: ['es'], fileName: () => 'runtime.mjs' }, rollupOptions: { output: { entryFileNames: 'runtime.mjs' } } } });
    return await action(await import(pathToFileURL(path.join(temp, 'runtime.mjs')).href));
  } finally { await rm(temp, { recursive: true, force: true }); }
}
