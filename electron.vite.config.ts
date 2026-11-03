import { fileURLToPath } from 'node:url';
import { access, cp, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { contract } from './src/shared/ipc/contract';

const at = (path: string): string => fileURLToPath(new URL(path, import.meta.url));
const alias = {
  '@shared': at('./src/shared'),
  '@main': at('./src/main'),
  '@engine': at('./src/engine'),
  '@renderer': at('./src/renderer'),
};

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin(), { name: 'cutroom-composition-assets', async closeBundle() {
    await build({ entryPoints: [at('./src/main/render/remotionWorker.ts')], outfile: at('./out/main/remotionWorker.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external' });
    const source = at('./src/compositions'); const output = at('./out/compositions'); await mkdir(output, { recursive: true }); await cp(source, output, { recursive: true });
    const entry = at('./src/compositions/bridge/host.ts');
    if (await access(entry).then(() => true, () => false)) await build({ entryPoints: [entry], outfile: at('./out/compositions/runtime/bridge.js'), bundle: true, platform: 'browser', format: 'iife', target: 'chrome130', alias: { '@shared': at('./src/shared') } });
  } }], resolve: { alias } },
  preload: {
    // A sandboxed preload cannot require arbitrary packages. Bundle all but Electron.
    resolve: { alias },
    define: {
      __IPC_INVOKE_CHANNELS__: JSON.stringify(Object.keys(contract.invoke)),
      __IPC_EVENT_CHANNELS__: JSON.stringify(Object.keys(contract.events)),
    },
    build: { rollupOptions: { output: { format: 'cjs', entryFileNames: 'index.cjs' } } },
  },
  renderer: {
    resolve: { alias }, plugins: [react()],
    server: { host: '127.0.0.1', ...(process.env.PORT ? { port: Number(process.env.PORT), strictPort: true } : {}) },
  },
});
