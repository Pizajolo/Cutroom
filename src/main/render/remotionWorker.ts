import { readFile } from 'node:fs/promises';
import { z } from 'zod/v3';
import { bundleRemotion } from './remotionBundle';
import { renderMedia, selectComposition } from '@remotion/renderer';

const request = z.object({ entry: z.string(), bundle: z.string(), binaries: z.string(), chrome: z.string(), output: z.string(), compositionId: z.string(), width: z.number().int().positive(), height: z.number().int().positive(), fps: z.number().positive(), duration: z.number().positive(), props: z.record(z.unknown()) }).strict();
async function main(): Promise<void> {
  const input = request.parse(JSON.parse(await readFile(process.argv[2]!, 'utf8')));
  const serveUrl = await bundleRemotion(input.entry, input.bundle);
  const selected = await selectComposition({ serveUrl, id: input.compositionId, inputProps: input.props, browserExecutable: input.chrome });
  await renderMedia({ serveUrl, composition: { ...selected, width: input.width, height: input.height, fps: input.fps, durationInFrames: Math.max(1, Math.round(input.duration * input.fps)) }, inputProps: input.props, codec: 'prores', proResProfile: '4444', imageFormat: 'png', pixelFormat: 'yuva444p10le', outputLocation: input.output, overwrite: false, binariesDirectory: input.binaries, browserExecutable: input.chrome, concurrency: 1, onProgress: ({ progress }) => process.stdout.write(`CUTROOM_RENDER=${progress}\n`) });
}
void main().catch(() => { process.stderr.write('Remotion rendering failed.\n'); process.exitCode = 1; });
