// Renders a Remotion composition to a transparent ProRes 4444 overlay.
import { createRequire } from 'node:module';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { ensureBrowser, renderMedia, selectComposition } from '@remotion/renderer';

export async function renderRemotion(entry: string, id: string, out: string, props: Record<string, unknown>): Promise<string> {
  // Compositions live in the user's project, which has no node_modules: resolve
  // `remotion` and `react` from Cutroom's own install instead.
  const modules = path.resolve(path.dirname(createRequire(import.meta.url).resolve('remotion/package.json')), '..');
  const serveUrl = await bundle({
    entryPoint: path.resolve(entry),
    webpackOverride: (config) => ({
      ...config,
      resolve: { ...config.resolve, modules: [modules, 'node_modules'] },
    }),
  });
  await ensureBrowser();
  const composition = await selectComposition({ serveUrl, id, inputProps: props });
  const outputLocation = path.resolve(out);
  await renderMedia({
    serveUrl,
    composition,
    inputProps: props,
    outputLocation,
    codec: 'prores',
    proResProfile: '4444',
    pixelFormat: 'yuva444p10le',
    imageFormat: 'png',
  });
  return outputLocation;
}
