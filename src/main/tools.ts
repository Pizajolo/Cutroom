// The editing toolbox: FFmpeg, Whisper and yt-dlp binaries, the cutout helper, plus launchers for the
// bundled `cutroom` CLI and HyperFrames. Everything ends up on PATH for the agent.
import { existsSync, statSync } from 'node:fs';
import { chmod, mkdir, rename, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { CUTOUT_BIN } from '../cli/cutout';
import { HOME, run } from '../cli/run';
import { WHISPER_MODEL } from '../cli/transcribe';
import type { ToolStatus } from '../shared/types';

const BIN = path.join(HOME, 'bin');
const YT_DLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos';
/** The Swift source of the cutout helper ships with the app and is compiled here, so it always fits this Mac. */
const CUTOUT_SOURCE = path.resolve(import.meta.dirname, '../../native/cutout.swift');
const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin';

// Apps launched from Finder get a bare PATH, so add the usual install locations.
process.env.PATH = [BIN, process.env.PATH, '/opt/homebrew/bin', '/usr/local/bin'].join(path.delimiter);

const find = (name: string): string | undefined =>
  process.env.PATH!.split(path.delimiter)
    .map((dir) => path.join(dir, name))
    .find((file) => existsSync(file));

async function download(url: string, file: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(`${file}.part`, Buffer.from(await res.arrayBuffer()), { mode: 0o755 });
  await rename(`${file}.part`, file);
}

async function brew(formula: string): Promise<void> {
  if (!find('brew')) throw new Error(`Install Homebrew (brew.sh), or run: brew install ${formula}`);
  await run('brew', ['install', formula]);
}

/** A launcher that runs a Node script with Electron's own runtime, so no system Node is needed. */
async function launcher(name: string, script: string): Promise<void> {
  const file = path.join(BIN, name);
  await writeFile(file, `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${process.execPath}" "${script}" "$@"\n`);
  await chmod(file, 0o755);
}

const TOOLS: { name: string; ready: () => boolean; install?: () => Promise<void> }[] = [
  { name: 'FFmpeg', ready: () => !!find('ffmpeg') && !!find('ffprobe'), install: () => brew('ffmpeg') },
  {
    name: 'Whisper',
    ready: () => !!find('whisper-cli') && existsSync(WHISPER_MODEL),
    install: async () => {
      if (!find('whisper-cli')) await brew('whisper-cpp');
      if (!existsSync(WHISPER_MODEL)) await download(MODEL_URL, WHISPER_MODEL);
    },
  },
  { name: 'yt-dlp', ready: () => !!find('yt-dlp'), install: () => download(YT_DLP_URL, path.join(BIN, 'yt-dlp')) },
  {
    name: 'Cutouts',
    // Rebuilt whenever the source is newer, e.g. after an update.
    ready: () => existsSync(CUTOUT_BIN) && statSync(CUTOUT_BIN).mtimeMs >= statSync(CUTOUT_SOURCE).mtimeMs,
    install: async () => {
      await run('swiftc', ['-O', CUTOUT_SOURCE, '-o', CUTOUT_BIN]).catch(() => {
        throw new Error('Needs Apple’s command line tools: run "xcode-select --install", then restart Cutroom');
      });
    },
  },
  // Bundled as npm dependencies.
  { name: 'Remotion', ready: () => true },
  { name: 'HyperFrames', ready: () => true },
];

let status: ToolStatus[] = TOOLS.map((t) => ({ name: t.name, state: 'missing' }));
export const toolStatus = (): ToolStatus[] => status;

/** Write the launchers, then install whatever is missing. Calls `onChange` as tools become ready. */
export async function ensureTools(onChange: (tools: ToolStatus[]) => void): Promise<void> {
  const set = (name: string, next: Omit<ToolStatus, 'name'>): void => {
    status = status.map((s) => (s.name === name ? { name, ...next } : s));
    onChange(status);
  };
  await mkdir(BIN, { recursive: true });
  const require = createRequire(import.meta.url);
  await launcher('cutroom', path.join(import.meta.dirname, 'cli.js'));
  await launcher('codex', require.resolve('@openai/codex/bin/codex.js'));
  await launcher('hyperframes', path.join(path.dirname(require.resolve('hyperframes/package.json')), 'bin/hyperframes.mjs'));

  for (const tool of TOOLS) {
    if (tool.ready()) {
      set(tool.name, { state: 'ready' });
      continue;
    }
    set(tool.name, { state: 'installing' });
    try {
      await tool.install?.();
      set(tool.name, { state: tool.ready() ? 'ready' : 'missing' });
    } catch (error) {
      set(tool.name, { state: 'missing', detail: (error as Error).message });
    }
  }
}
