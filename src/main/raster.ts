// Pictures made in a hidden Chromium page: SVG drawn to PNG (with transparency), and pictures traced to SVG.
// Chromium draws SVG exactly as the app and the exports will, and needs no native image library.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { BrowserWindow } from 'electron';

let page: BrowserWindow | undefined;
let idle: NodeJS.Timeout | undefined;
let tracer: string | undefined;

/** A blank offscreen page, kept for a minute between uses. */
async function blank(): Promise<BrowserWindow> {
  clearTimeout(idle);
  idle = setTimeout(() => {
    page?.destroy();
    page = undefined;
  }, 60_000);
  if (page && !page.isDestroyed()) return page;
  page = new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: { offscreen: true, sandbox: true, javascript: true } });
  await page.loadURL('data:text/html;charset=utf-8,<!doctype html><title>raster</title>');
  return page;
}

/** Run a script in the page; it must evaluate to something JSON can carry. */
async function run<T>(script: string): Promise<T> {
  return (await (await blank()).webContents.executeJavaScript(script, true)) as T;
}

export const svgDataUrl = (svg: string): string => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

/** An SVG as a PNG, `size` px on its longest side, transparent around it. */
export async function svgToPng(svg: string, size: number): Promise<Buffer> {
  const url = await run<string>(`(async () => {
    const img = new Image(); img.src = ${JSON.stringify(svgDataUrl(svg))}; await img.decode();
    const w0 = img.naturalWidth || 1000, h0 = img.naturalHeight || 1000, k = ${size} / Math.max(w0, h0);
    const c = document.createElement('canvas'); c.width = Math.round(w0 * k); c.height = Math.round(h0 * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  })()`);
  return Buffer.from(url.split(',')[1]!, 'base64');
}

/**
 * A sheet for judging a logo: large on light, dark and the brand colour, then small (64 and 32 px) on light and dark —
 * a logo has to hold at icon size.
 */
export async function proofSheet(svg: string, brand: string): Promise<Buffer> {
  const url = await run<string>(`(async () => {
    const img = new Image(); img.src = ${JSON.stringify(svgDataUrl(svg))}; await img.decode();
    const W = 1560, H = 640, c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    const fit = (x, y, w, h, pad) => {
      const k = Math.min((w - 2 * pad) / (img.naturalWidth || 1000), (h - 2 * pad) / (img.naturalHeight || 1000));
      const dw = (img.naturalWidth || 1000) * k, dh = (img.naturalHeight || 1000) * k;
      g.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    };
    const panels = ['#ffffff', '#141414', ${JSON.stringify(brand)}];
    panels.forEach((bg, i) => { g.fillStyle = bg; g.fillRect(i * 520, 0, 520, 480); fit(i * 520, 0, 520, 480, 56); });
    g.fillStyle = '#ffffff'; g.fillRect(0, 480, 780, 160); g.fillStyle = '#141414'; g.fillRect(780, 480, 780, 160);
    for (const [x, s] of [[120, 64], [300, 32], [900, 64], [1080, 32]]) fit(x, 480 + (160 - s) / 2, s, s, 0);
    g.font = '15px -apple-system, sans-serif'; g.fillStyle = '#888';
    g.fillText('64 px', 120, 630); g.fillText('32 px', 300, 630); g.fillText('64 px', 900, 630); g.fillText('32 px', 1080, 630);
    return c.toDataURL('image/png');
  })()`);
  return Buffer.from(url.split(',')[1]!, 'base64');
}

/**
 * Trace a picture (PNG, JPEG, WebP or SVG data: URL) into SVG shapes with ImageTracer. `colors` caps the palette
 * (2 for a one-colour logo on a background); near-transparent areas stay empty.
 */
export async function traceImage(dataUrl: string, colors: number, detail: 'clean' | 'detailed'): Promise<{ svg: string; kept: number; dropped: number }> {
  tracer ??= await readFile(path.join(path.dirname(createRequire(import.meta.url).resolve('imagetracerjs/package.json')), 'imagetracer_v1.2.6.js'), 'utf8');
  // Smooth curves come from tracing a large, slightly softened picture: small logos are scaled up first.
  const options = detail === 'clean'
    ? { numberofcolors: colors, ltres: 1, qtres: 0.6, pathomit: 24, rightangleenhance: false, blurradius: 2, blurdelta: 64, linefilter: true, roundcoords: 1, colorsampling: 2, colorquantcycles: 4, mincolorratio: 0.02, strokewidth: 0 }
    : { numberofcolors: colors, ltres: 0.6, qtres: 0.4, pathomit: 8, rightangleenhance: false, blurradius: 1, blurdelta: 64, roundcoords: 1, colorsampling: 2, colorquantcycles: 4, mincolorratio: 0.005, strokewidth: 0 };
  const { svg: raw, corner, width, height } = await run<{ svg: string; corner: number[]; width: number; height: number }>(`(async () => {
    if (!window.ImageTracer) { ${tracer}\n; }
    const img = new Image(); img.src = ${JSON.stringify(dataUrl)}; await img.decode();
    const k = 1600 / Math.max(img.naturalWidth || 1000, img.naturalHeight || 1000);
    const c = document.createElement('canvas'); c.width = Math.round((img.naturalWidth || 1000) * k); c.height = Math.round((img.naturalHeight || 1000) * k);
    const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, c.width, c.height);
    const data = c.getContext('2d').getImageData(0, 0, c.width, c.height);
    const at = (x, y) => Array.from(data.data.slice((y * c.width + x) * 4, (y * c.width + x) * 4 + 4));
    const corners = [at(0, 0), at(c.width - 1, 0), at(0, c.height - 1), at(c.width - 1, c.height - 1)];
    const corner = [0, 1, 2, 3].map((k) => Math.round(corners.reduce((s, p) => s + p[k], 0) / 4));
    return { svg: window.ImageTracer.imagedataToSVG(data, ${JSON.stringify(options)}), corner, width: c.width, height: c.height };
  })()`);
  // Leave out the background (the colour of the corners, when they are opaque) and shapes nobody can see.
  const near = (fill: string): boolean => {
    const rgb = /rgb\((\d+),(\d+),(\d+)\)/.exec(fill.replace(/\s/g, ''));
    return !!rgb && corner[3]! > 200 && Math.hypot(Number(rgb[1]) - corner[0]!, Number(rgb[2]) - corner[1]!, Number(rgb[3]) - corner[2]!) < 48;
  };
  let kept = 0;
  let dropped = 0;
  const paths = (raw.match(/<path[^>]*\/>/g) ?? []).filter((p) => {
    const fill = /fill="([^"]+)"/.exec(p)?.[1] ?? '';
    const opacity = Number(/opacity="([\d.]+)"/.exec(p)?.[1] ?? '1');
    const keep = opacity > 0.1 && !near(fill);
    if (keep) kept++;
    else dropped++;
    return keep;
  })// Shapes of a logo are solid: the tracer's opacity only carries the softened edge.
  .map((p) => p.replace(/\s(stroke|stroke-width|opacity)="[^"]*"/g, ''));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">\n${paths.join('\n')}\n</svg>`;
  return { svg, kept, dropped };
}

export function closeRaster(): void {
  clearTimeout(idle);
  page?.destroy();
  page = undefined;
}
