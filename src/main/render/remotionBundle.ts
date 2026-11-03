import { readFile, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Compiler } from 'webpack';
import { bundle } from '@remotion/bundler';

const require = createRequire(import.meta.url);
const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export async function bundleRemotion(entry: string, output: string): Promise<string> {
  const source = await realpath(path.dirname(entry)); const modules = await realpath(path.dirname(path.dirname(require.resolve('remotion/package.json'))));
  const allowed = new RegExp(`^(?:${[source, modules].map(escape).join('|')})(?:[/\\\\]|$)`);
  const serveUrl = await bundle({
    entryPoint: entry, outDir: output, rootDir: source, publicDir: path.join(source, 'public'), enableCaching: false, gitSource: null,
    onSymlinkDetected: () => { throw new Error('Symlinks are not allowed in composition assets.'); },
    webpackOverride: (configuration) => ({ ...configuration,
      resolve: { ...configuration.resolve, modules: [modules, ...(configuration.resolve?.modules ?? [])], restrictions: [allowed] },
      resolveLoader: { ...configuration.resolveLoader, restrictions: [new RegExp(`^${escape(modules)}(?:[/\\\\]|$)`)] },
      plugins: [...(configuration.plugins ?? []), { apply(compiler: Compiler) {
        compiler.hooks.normalModuleFactory.tap('CutroomLocalModules', (factory) => {
          factory.hooks.beforeResolve.tap('CutroomLocalModules', (request) => { if (request?.request.includes('!')) throw new Error('Authored inline webpack loaders are not allowed.'); });
        });
      } }],
    }),
  });
  // Browser resources stay local too; this is defense in depth, not an OS sandbox.
  const file = path.join(serveUrl, 'index.html'); const html = await readFile(file, 'utf8');
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'">`;
  if (!html.includes('<head>')) throw new Error('Remotion bundle has no document head.');
  await writeFile(file, html.replace('<head>', `<head>${csp}`)); return serveUrl;
}
