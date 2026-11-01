import { fileURLToPath } from 'node:url';
import { withToolRuntime } from './tool-runtime.mjs';

try {
  await withToolRuntime(({ buildWhisper }) => buildWhisper({ root: fileURLToPath(new URL('../', import.meta.url)), pin: process.argv.includes('--pin'), log: console.log }));
} catch (error) { console.error(error instanceof Error ? error.message : 'Whisper build failed.'); process.exitCode = 1; }
