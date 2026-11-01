import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const alias = {
  '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
  '@main': fileURLToPath(new URL('./src/main', import.meta.url)),
  '@engine': fileURLToPath(new URL('./src/engine', import.meta.url)),
  '@renderer': fileURLToPath(new URL('./src/renderer', import.meta.url)),
};

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/main/**/*.test.ts', 'src/{main,engine,shared,cli}/**/*.test.ts'],
        },
      },
      {
        resolve: { alias },
        esbuild: { jsx: 'automatic' },
        test: {
          name: 'web',
          environment: 'jsdom',
          include: ['src/{renderer,compositions}/**/*.test.{ts,tsx}', 'tests/renderer/**/*.test.{ts,tsx}'],
        },
      },
    ],
  },
});
