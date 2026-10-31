import { fileURLToPath } from 'node:url';
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
  main: { plugins: [externalizeDepsPlugin()], resolve: { alias } },
  preload: {
    // A sandboxed preload cannot require arbitrary packages. Bundle all but Electron.
    resolve: { alias },
    define: {
      __IPC_INVOKE_CHANNELS__: JSON.stringify(Object.keys(contract.invoke)),
      __IPC_EVENT_CHANNELS__: JSON.stringify(Object.keys(contract.events)),
    },
    build: { rollupOptions: { output: { format: 'cjs', entryFileNames: 'index.cjs' } } },
  },
  renderer: { resolve: { alias }, plugins: [react()] },
});
