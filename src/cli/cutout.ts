// Subject cutouts and stickers, made on this Mac by a small Swift helper around Apple's Vision framework
// (native/cutout.swift, compiled on first launch).
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HDR_TO_SDR, isHdr } from './render';
import { HOME, run } from './run';

export const CUTOUT_BIN = path.join(HOME, 'bin/cutroom-cutout');
export const CUTOUT_USAGE = `cutroom cutout <in> <out.png> [--at s] [--subject any|person] [--outline 0.02] [--no-trim]
       cutroom cutout <in> <out.mov> [--from s] [--to s] [--subject any|person]`;

/** `cutroom cutout <in> <out> [flags]`: a .png sticker of the subject, or a .mov of it with the background gone. */
export async function cutout(root: string, args: string[]): Promise<string> {
  const [input, out, ...flags] = args;
  if (!input || !out || out.startsWith('--')) throw new Error(`Usage: ${CUTOUT_USAGE}`);
  if (!existsSync(CUTOUT_BIN)) {
    throw new Error('Cutouts are not set up on this Mac: they need Apple’s command line tools. The user can install them with "xcode-select --install" and restart Cutroom.');
  }
  const take = (name: string): string | undefined => {
    const i = flags.indexOf(name);
    return i < 0 ? undefined : flags.splice(i, 2)[1];
  };
  let source = path.resolve(root, input);
  const scratch = await mkdtemp(path.join(tmpdir(), 'cutroom-cutout-'));
  try {
    // HDR footage is brought to standard range exactly as the renderer does it, so a cutout laid back over its clip matches.
    if (existsSync(source) && (await isHdr(source))) {
      const [at, from, to] = [take('--at'), take('--from'), take('--to')];
      const still = /\.png$/i.test(out);
      const range = still ? ['-ss', at ?? '0'] : [...(from ? ['-ss', from] : []), ...(to ? ['-to', to] : [])];
      const converted = path.join(scratch, still ? 'frame.png' : 'sdr.mov');
      await run('ffmpeg', [
        '-v', 'error', '-init_hw_device', 'videotoolbox=vt', '-filter_hw_device', 'vt', ...range, '-i', source, '-vf', HDR_TO_SDR, '-an',
        ...(still ? ['-frames:v', '1'] : ['-c:v', 'prores_ks', '-profile:v', '3']), converted,
      ]);
      source = converted;
    }
    return (await run(CUTOUT_BIN, [source, path.resolve(root, out), ...flags])).trim().replace(path.basename(out), out);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
