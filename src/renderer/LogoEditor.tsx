import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Crop, Pipette, RotateCcw, Scissors, Wand2, X } from 'lucide-react';
import type { BrandKit, LogoSlot } from '../shared/brand';
import { api, failed } from './lib';

const SLOTS: Record<LogoSlot, string> = { main: 'Full logo', mark: 'Icon only', onDark: 'For dark backgrounds' };
/** Larger images are worked on at this size (longest side), so every change stays instant. SVGs are drawn at it. */
const WORK = 2000;

interface Rect { x: number; y: number; w: number; h: number }
const FULL: Rect = { x: 0, y: 0, w: 1, h: 1 };

interface Edit {
  bg: { on: boolean; color: string; /** 0–100: how far from the colour still counts as background */ tolerance: number; /** 0–50: soft edge */ soft: number; /** also holes inside the logo, not only what touches the edge */ everywhere: boolean };
  color: { mode: 'original' | 'solid' | 'replace' | 'gray' | 'invert'; solid: string; from: string; to: string; tolerance: number };
  /** Fractions of the image. */
  crop: Rect;
  /** 1 = the crop fills the result; below adds space around it, above cuts in from the middle. */
  zoom: number;
}

const message = (cause: unknown): string => (cause as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const hex = (r: number, g: number, b: number): string => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
const rgb = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
/** Colour distance as 0–100. */
const distance = (r: number, g: number, b: number, [R, G, B]: [number, number, number]): number => Math.hypot(r - R, g - G, b - B) / 4.4167;

/** Load a data: URL as pixels, at most WORK px on its longest side (SVGs and tiny images are drawn at WORK). */
async function pixels(src: string): Promise<ImageData> {
  const img = new Image();
  img.src = src;
  await img.decode();
  const svg = src.startsWith('data:image/svg');
  const w0 = img.naturalWidth || 1000;
  const h0 = img.naturalHeight || 1000;
  const scale = svg || Math.max(w0, h0) > WORK ? WORK / Math.max(w0, h0) : 1;
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(w0 * scale)), Math.max(1, Math.round(h0 * scale)));
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/** The background (or holes) made transparent and the colours changed: everything but crop and zoom. */
function process(source: ImageData, edit: Edit): ImageData {
  const { width: w, height: h } = source;
  const out = new ImageData(new Uint8ClampedArray(source.data), w, h);
  const d = out.data;
  if (edit.bg.on) {
    const key = rgb(edit.bg.color);
    const { tolerance: tol, soft } = edit.bg;
    const alphaFor = (i: number): number => {
      const dist = distance(d[i]!, d[i + 1]!, d[i + 2]!, key);
      return dist <= tol ? 0 : dist >= tol + soft ? 1 : (dist - tol) / Math.max(soft, 0.001);
    };
    if (edit.bg.everywhere) {
      for (let i = 0; i < d.length; i += 4) d[i + 3] = d[i + 3]! * alphaFor(i);
    } else {
      // Only background that touches the edge, so white letters inside a logo stay.
      const reach = new Uint8Array(w * h);
      const stack: number[] = [];
      const near = (p: number): boolean => d[p * 4 + 3]! < 8 || distance(d[p * 4]!, d[p * 4 + 1]!, d[p * 4 + 2]!, key) < tol + soft;
      for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
      for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
      while (stack.length) {
        const p = stack.pop()!;
        if (reach[p] || !near(p)) continue;
        reach[p] = 1;
        const x = p % w;
        if (x > 0) stack.push(p - 1);
        if (x < w - 1) stack.push(p + 1);
        if (p >= w) stack.push(p - w);
        if (p < w * (h - 1)) stack.push(p + w);
      }
      for (let p = 0; p < w * h; p++) if (reach[p]) d[p * 4 + 3] = d[p * 4 + 3]! * alphaFor(p * 4);
    }
  }
  const c = edit.color;
  if (c.mode !== 'original') {
    const solid = rgb(c.solid);
    const from = rgb(c.from);
    const to = rgb(c.to);
    for (let i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue;
      const [r, g, b] = [d[i]!, d[i + 1]!, d[i + 2]!];
      if (c.mode === 'solid') [d[i], d[i + 1], d[i + 2]] = solid;
      else if (c.mode === 'gray') d[i] = d[i + 1] = d[i + 2] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      else if (c.mode === 'invert') [d[i], d[i + 1], d[i + 2]] = [255 - r, 255 - g, 255 - b];
      else {
        // Shift colours near `from` towards `to`, keeping their shading and soft edges.
        const weight = Math.max(0, 1 - distance(r, g, b, from) / Math.max(c.tolerance, 1));
        if (weight) [d[i], d[i + 1], d[i + 2]] = [r + (to[0] - from[0]) * weight, g + (to[1] - from[1]) * weight, b + (to[2] - from[2]) * weight];
      }
    }
  }
  return out;
}

/** The result: the crop of the processed image, zoomed in its own frame. */
function compose(image: ImageData, crop: Rect, zoom: number): OffscreenCanvas {
  const src = new OffscreenCanvas(image.width, image.height);
  src.getContext('2d')!.putImageData(image, 0, 0);
  const [cx, cy, cw, ch] = [crop.x * image.width, crop.y * image.height, Math.max(1, crop.w * image.width), Math.max(1, crop.h * image.height)];
  const out = new OffscreenCanvas(Math.round(cw), Math.round(ch));
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  const [dw, dh] = [cw * zoom, ch * zoom];
  ctx.drawImage(src, cx, cy, cw, ch, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
  return out;
}

/** The smallest crop around everything visible. */
function trimmed(image: ImageData): Rect {
  const { width: w, height: h, data } = image;
  let [x0, y0, x1, y1] = [w, h, -1, -1];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3]! > 8) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
    }
  }
  return x1 < 0 ? FULL : { x: x0 / w, y: y0 / h, w: (x1 - x0 + 1) / w, h: (y1 - y0 + 1) / h };
}

/** The colour of the corners, if they agree: most logos sit on a plain background. */
function cornerColor(image: ImageData): string | undefined {
  const { width: w, height: h, data } = image;
  const at = (x: number, y: number): number[] => [...data.slice((y * w + x) * 4, (y * w + x) * 4 + 4)];
  const corners = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)];
  if (corners.some((c) => c[3]! < 250)) return undefined;
  const [r, g, b] = [0, 1, 2].map((k) => Math.round(corners.reduce((s, c) => s + c[k]!, 0) / 4));
  return corners.every((c) => distance(c[0]!, c[1]!, c[2]!, [r!, g!, b!]) < 6) ? hex(r!, g!, b!) : undefined;
}

const VIEWS = { checker: 'Transparent', dark: 'Dark', light: 'Light', brand: 'Brand colour' } as const;

/** Edit a logo: remove its background, crop, zoom and recolour, then save it into a slot of the kit. */
export function LogoEditor({ kit, slot, onClose, onSaved }: { kit: BrandKit; slot: LogoSlot; onClose: () => void; onSaved: (kit: BrandKit) => void }) {
  const [source, setSource] = useState<{ url: string; data: ImageData; lifted: boolean } | null>(null);
  const [original, setOriginal] = useState<string>('');
  const [edit, setEdit] = useState<Edit>({
    bg: { on: false, color: '#ffffff', tolerance: 18, soft: 8, everywhere: false },
    color: { mode: 'original', solid: '#ffffff', from: kit.colors.primary, to: kit.colors.accent, tolerance: 30 },
    crop: FULL,
    zoom: 1,
  });
  const [target, setTarget] = useState<LogoSlot>(slot);
  const [view, setView] = useState<keyof typeof VIEWS>('checker');
  const [picking, setPicking] = useState<'' | 'bg' | 'from'>('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [drag, setDrag] = useState<Rect | null>(null);
  const stage = useRef<HTMLCanvasElement>(null);
  const result = useRef<HTMLCanvasElement>(null);

  const load = async (url: string, lifted: boolean): Promise<void> => {
    const data = await pixels(url);
    setSource({ url, data, lifted });
    const corner = cornerColor(data);
    if (corner && !lifted) setEdit((e) => ({ ...e, bg: { ...e.bg, color: corner } }));
  };
  useEffect(() => {
    const file = kit.logos[slot];
    if (!file) return;
    void api.readBrandImage(kit.id, file).then((url) => (setOriginal(url), load(url, false))).catch(failed);
    const onKey = (e: KeyboardEvent): void => void (e.key === 'Escape' && onClose());
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const processed = useMemo(() => (source ? process(source.data, edit) : null), [source, edit.bg, edit.color]);
  // The editing view: the whole image with the crop marked.
  useEffect(() => {
    const canvas = stage.current;
    if (!canvas || !processed) return;
    canvas.width = processed.width;
    canvas.height = processed.height;
    canvas.getContext('2d')!.putImageData(processed, 0, 0);
  }, [processed]);
  // The result, as it will be saved.
  useEffect(() => {
    const canvas = result.current;
    if (!canvas || !processed) return;
    const out = compose(processed, edit.crop, edit.zoom);
    canvas.width = out.width;
    canvas.height = out.height;
    canvas.getContext('2d')!.drawImage(out, 0, 0);
  }, [processed, edit.crop, edit.zoom]);

  const set = <K extends keyof Edit>(key: K, patch: Partial<Edit[K]>): void =>
    setEdit((e) => ({ ...e, [key]: typeof e[key] === 'object' ? { ...(e[key] as object), ...patch } : patch }));
  /** Where the pointer is, as fractions of the image. */
  const at = (e: ReactPointerEvent): { x: number; y: number } => {
    const r = stage.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const down = (e: ReactPointerEvent): void => {
    const p = at(e);
    if (picking && source) {
      // Pick from the image as it was, before any change.
      const { width, data } = source.data;
      const i = (Math.floor(p.y * (source.data.height - 1)) * width + Math.floor(p.x * (width - 1))) * 4;
      const color = hex(data[i]!, data[i + 1]!, data[i + 2]!);
      if (picking === 'bg') set('bg', { color, on: true });
      else set('color', { from: color, mode: 'replace' });
      setPicking('');
      return;
    }
    (e.target as Element).setPointerCapture(e.pointerId);
    setDrag({ x: p.x, y: p.y, w: 0, h: 0 });
  };
  const move = (e: ReactPointerEvent): void => {
    if (!drag) return;
    // The button was let go somewhere we did not hear about: the drag is over.
    if (!(e.buttons & 1)) return up();
    const p = at(e);
    setDrag({ ...drag, w: p.x - drag.x, h: p.y - drag.y });
  };
  const up = (): void => {
    if (!drag) return;
    const rect = { x: Math.min(drag.x, drag.x + drag.w), y: Math.min(drag.y, drag.y + drag.h), w: Math.abs(drag.w), h: Math.abs(drag.h) };
    // A click (no real drag) leaves the crop as it is.
    if (rect.w > 0.02 && rect.h > 0.02) set('crop', rect);
    setDrag(null);
  };
  const lift = async (): Promise<void> => {
    if (!source) return;
    setBusy('Lifting the logo with Apple Vision…');
    setError('');
    try {
      // The helper reads PNG/JPEG/WebP: an SVG is handed over as drawn.
      let url = source.url;
      if (url.startsWith('data:image/svg')) {
        const c = new OffscreenCanvas(source.data.width, source.data.height);
        c.getContext('2d')!.putImageData(source.data, 0, 0);
        const blob = await c.convertToBlob({ type: 'image/png' });
        url = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.readAsDataURL(blob);
        });
      }
      await load(await api.liftImage(url), true);
      setEdit((e) => ({ ...e, bg: { ...e.bg, on: false }, crop: FULL }));
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy('');
    }
  };
  const save = async (): Promise<void> => {
    if (!processed) return;
    setBusy('Saving…');
    setError('');
    try {
      const blob = await compose(processed, edit.crop, edit.zoom).convertToBlob({ type: 'image/png' });
      onSaved(await api.saveLogo(kit, target, new Uint8Array(await blob.arrayBuffer())));
      onClose();
    } catch (cause) {
      setError(message(cause));
      setBusy('');
    }
  };

  const crop = drag ? { x: Math.min(drag.x, drag.x + drag.w), y: Math.min(drag.y, drag.y + drag.h), w: Math.abs(drag.w), h: Math.abs(drag.h) } : edit.crop;
  const cropped = crop !== FULL && (crop.w < 0.999 || crop.h < 0.999);
  const swatches = [...new Set([...Object.values(kit.colors), '#ffffff', '#000000'])];
  const backdrop = view === 'brand' ? kit.colors.primary : view === 'dark' ? '#111418' : view === 'light' ? '#f4f4f2' : undefined;

  return (
    <div className="modal" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="logo-editor" role="dialog" aria-label="Edit logo">
        <header>
          <h2>Edit {SLOTS[slot].toLowerCase()}</h2>
          {source?.lifted && <span className="tag">Lifted with Apple Vision</span>}
          <span className="spacer" />
          <div className="switch" role="tablist" aria-label="Background to judge it on">
            {(Object.keys(VIEWS) as (keyof typeof VIEWS)[]).map((v) => (
              <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}>{VIEWS[v]}</button>
            ))}
          </div>
          <button className="ghost round" aria-label="Close" onClick={onClose}><X size={16} /></button>
        </header>
        <div className="logo-editor-body">
          <div className={`logo-stage${view === 'checker' ? ' checker' : ''}${picking ? ' picking' : ''}`} style={{ background: backdrop }}>
            {!source && <p className="hint">Loading…</p>}
            <div className="canvas-wrap">
              <canvas ref={stage} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)} onLostPointerCapture={up} aria-label="Logo: drag to crop" />
              {source && cropped && (
                <div className="crop-frame" style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` }} />
              )}
            </div>
            <p className="hint">{picking ? 'Click the colour in the logo.' : 'Drag across the logo to crop it.'}</p>
          </div>

          <form className="settings logo-controls" onSubmit={(e) => e.preventDefault()}>
            <div className={`logo-result${view === 'checker' ? ' checker' : ''}`} style={{ background: backdrop }}>
              <canvas ref={result} aria-label="Result" />
            </div>

            <section>
              <h2>Background</h2>
              <label className="choice"><input type="checkbox" checked={edit.bg.on} onChange={(e) => set('bg', { on: e.target.checked })} /> Remove the background colour</label>
              <div className="fields">
                <input type="color" value={edit.bg.color} aria-label="Background colour" onChange={(e) => set('bg', { color: e.target.value, on: true })} />
                <button type="button" className={picking === 'bg' ? 'active' : ''} onClick={() => setPicking(picking === 'bg' ? '' : 'bg')}><Pipette size={14} /> Pick</button>
                <label className="field">
                  <span className="label">Tolerance · {edit.bg.tolerance}</span>
                  <input type="range" min={0} max={60} value={edit.bg.tolerance} onChange={(e) => set('bg', { tolerance: Number(e.target.value), on: true })} />
                </label>
                <label className="field">
                  <span className="label">Soft edge · {edit.bg.soft}</span>
                  <input type="range" min={0} max={40} value={edit.bg.soft} onChange={(e) => set('bg', { soft: Number(e.target.value), on: true })} />
                </label>
              </div>
              <label className="choice"><input type="checkbox" checked={edit.bg.everywhere} onChange={(e) => set('bg', { everywhere: e.target.checked, on: true })} /> Also inside the logo (holes in letters)</label>
              <button type="button" disabled={!!busy || !source} title="For a logo on a photo or a busy background" onClick={() => void lift()}><Wand2 size={14} /> Lift it off with Apple Vision</button>
              {source?.lifted && <button type="button" className="ghost" onClick={() => void load(original, false)}><RotateCcw size={14} /> Back to the original</button>}
              {error && <p className="note error" role="alert">{error}</p>}
            </section>

            <section>
              <h2>Crop and zoom</h2>
              <div className="fields">
                <button type="button" disabled={!processed} onClick={() => processed && set('crop', trimmed(processed))}><Scissors size={14} /> Trim to the logo</button>
                <button type="button" disabled={!cropped} onClick={() => set('crop', FULL)}><Crop size={14} /> Whole image</button>
              </div>
              <label className="field">
                <span className="label">Zoom · {Math.round(edit.zoom * 100)}%{edit.zoom < 1 ? ' (adds space around it)' : ''}</span>
                <input type="range" min={0.5} max={3} step={0.05} value={edit.zoom} onChange={(e) => setEdit({ ...edit, zoom: Number(e.target.value) })} />
              </label>
            </section>

            <section>
              <h2>Colour</h2>
              <select value={edit.color.mode} aria-label="Colour change" onChange={(e) => set('color', { mode: e.target.value as Edit['color']['mode'] })}>
                <option value="original">Original colours</option>
                <option value="solid">All one colour</option>
                <option value="replace">Swap one colour</option>
                <option value="gray">Black and white</option>
                <option value="invert">Inverted</option>
              </select>
              {edit.color.mode === 'solid' && (
                <div className="swatches">
                  {swatches.map((s) => (
                    <button key={s} type="button" className={edit.color.solid === s ? 'swatch-pick on' : 'swatch-pick'} style={{ background: s }} title={s} aria-label={s} onClick={() => set('color', { solid: s })} />
                  ))}
                  <input type="color" value={edit.color.solid} aria-label="Other colour" onChange={(e) => set('color', { solid: e.target.value })} />
                </div>
              )}
              {edit.color.mode === 'replace' && (
                <>
                  <div className="fields">
                    <span className="label">From</span>
                    <input type="color" value={edit.color.from} aria-label="Colour to change" onChange={(e) => set('color', { from: e.target.value })} />
                    <button type="button" className={picking === 'from' ? 'active' : ''} onClick={() => setPicking(picking === 'from' ? '' : 'from')}><Pipette size={14} /> Pick</button>
                    <span className="label">to</span>
                    <input type="color" value={edit.color.to} aria-label="New colour" onChange={(e) => set('color', { to: e.target.value })} />
                  </div>
                  <div className="swatches">
                    {swatches.map((s) => (
                      <button key={s} type="button" className={edit.color.to === s ? 'swatch-pick on' : 'swatch-pick'} style={{ background: s }} title={`To ${s}`} aria-label={`To ${s}`} onClick={() => set('color', { to: s })} />
                    ))}
                  </div>
                  <label className="field">
                    <span className="label">How similar · {edit.color.tolerance}</span>
                    <input type="range" min={5} max={80} value={edit.color.tolerance} onChange={(e) => set('color', { tolerance: Number(e.target.value) })} />
                  </label>
                </>
              )}
            </section>

            <footer className="row">
              <span className="label">Save as</span>
              <select value={target} aria-label="Save into" onChange={(e) => setTarget(e.target.value as LogoSlot)}>
                {(Object.keys(SLOTS) as LogoSlot[]).map((s) => <option key={s} value={s}>{SLOTS[s]}{kit.logos[s] && s !== slot ? ' (replaces it)' : ''}</option>)}
              </select>
              <span className="spacer" />
              {busy && <span className="note">{busy}</span>}
              <button type="button" onClick={onClose}>Cancel</button>
              <button type="button" className="primary" disabled={!processed || !!busy} onClick={() => void save()}>Save</button>
            </footer>
          </form>
        </div>
      </section>
    </div>
  );
}
