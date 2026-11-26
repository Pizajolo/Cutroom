import { useLayoutEffect, useRef, useState } from 'react';
import { AlignCenter, AlignLeft, AlignRight, ImagePlus, LayoutTemplate, RotateCcw, ShieldCheck, TriangleAlert, X } from 'lucide-react';
import { ASPECTS, PLATFORMS, defaultLayout, safeArea } from '../shared/brand';
import type { BrandKit, ColorRole, Layout, LogoSlot, Platform, TextBox } from '../shared/brand';
import { ELEMENT_NAMES, LayoutFrame, colorOf, measure } from './LayoutFrame';
import type { Element } from './LayoutFrame';

const COLORS: Record<ColorRole, string> = { text: 'Text', primary: 'Primary', secondary: 'Secondary', accent: 'Accent', background: 'Background', white: 'White', black: 'Black' };
const LOGOS: Record<LogoSlot, string> = { main: 'Full logo', mark: 'Icon', onDark: 'For dark backgrounds' };
const pct = (v: number): number => Math.round(v * 1000) / 10;

interface Overlap { element: Element; platform: Platform; what: string }
/** Two elements on top of each other. */
interface Clash { a: Element; b: Element }

/**
 * Where titles, subtitles, captions, the logo and the handle tag sit, and how they look: drag them in a frame, with
 * TikTok's, Instagram's and YouTube's buttons and text drawn on top so nothing important ends up under them.
 */
export function LayoutStudio({ kit, update, onClose }: { kit: BrandKit; update: (patch: Partial<BrandKit>) => void; onClose: () => void }) {
  const [selected, setSelected] = useState<Element | ''>('caption');
  const [platform, setPlatform] = useState<Platform | ''>(kit.layout.platforms[0] ?? '');
  const [zones, setZones] = useState(true);
  const [aspect, setAspect] = useState<keyof typeof ASPECTS>(kit.format.aspect || '9:16');
  const [picture, setPicture] = useState('');
  const [overlaps, setOverlaps] = useState<Overlap[]>([]);
  const [clashes, setClashes] = useState<Clash[]>([]);
  const initial = useRef(kit.layout);
  const frame = useRef<HTMLDivElement>(null);
  const l = kit.layout;
  const vertical = ASPECTS[aspect].height > ASPECTS[aspect].width;

  const setLayout = (next: Layout): void => update({ layout: next });
  const patchBox = (element: Element, patch: Record<string, unknown>): void => {
    if (element === 'logo') setLayout({ ...l, logo: { ...l.logo, ...patch } });
    else if (element === 'handle') setLayout({ ...l, handle: { ...l.handle, ...patch } });
    else setLayout({ ...l, [element]: { ...l[element], ...patch } });
  };

  // What the apps cover: measured on screen after every change, against every app the kit keeps clear of.
  useLayoutEffect(() => {
    const check = (): void => {
      if (!frame.current) return;
      const boxes = measure(frame.current.querySelector('.layout-frame')!);
      const found: Overlap[] = [];
      const shownOf = (element: Element): boolean =>
        element === 'logo' ? kit.watermark.on : element === 'handle' ? l.handle.on : element === 'caption' ? kit.captions.mode !== 'off' && l.caption.on : l[element].on;
      // Elements on top of each other (by more than a sliver).
      const shown = (Object.entries(boxes) as [Element, { x: number; y: number; w: number; h: number }][]).filter(([e]) => shownOf(e));
      const found2: Clash[] = [];
      shown.forEach(([a, p], i) => shown.slice(i + 1).forEach(([b, q]) => {
        const w = Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x);
        const h = Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y);
        if (w > 0.01 && h > 0.006) found2.push({ a, b });
      }));
      setClashes(found2);
      if (!vertical) return setOverlaps([]);
      for (const [element, b] of shown) {
        for (const p of l.platforms) {
          const z = PLATFORMS[p].zones.find((z) => b.x < z.x + z.w && b.x + b.w > z.x && b.y < z.y + z.h && b.y + b.h > z.y);
          if (z) found.push({ element, platform: p, what: z.what });
        }
      }
      setOverlaps(found);
    };
    check();
    // Fonts arrive a moment later and change text sizes.
    const timer = setTimeout(check, 400);
    return () => clearTimeout(timer);
  }, [kit, aspect]);

  /** A drag. A subtitle just under the title goes along with it, as one block. */
  const move = (element: Element, patch: Partial<{ x: number; y: number; w: number; size: number }>): void => {
    const t = l.title;
    const s = l.subtitle;
    const together = element === 'title' && (patch.x !== undefined || patch.y !== undefined) && s.on && s.y >= t.y && s.y - t.y < 0.2;
    if (!together) return patchBox(element, patch);
    const dx = (patch.x ?? t.x) - t.x;
    const dy = (patch.y ?? t.y) - t.y;
    setLayout({ ...l, title: { ...t, ...patch }, subtitle: { ...s, x: Math.min(Math.max(s.x + dx, 0), 1 - s.w), y: Math.min(Math.max(s.y + dy, 0), 0.98) } });
  };

  /** Move (and narrow if needed) everything that an app covers into the area none of them uses. */
  const fit = (): void => {
    if (!frame.current) return;
    const safe = safeArea(l.platforms);
    const boxes = measure(frame.current.querySelector('.layout-frame')!);
    const next: Layout = structuredClone(l);
    for (const element of new Set(overlaps.map((o) => o.element))) {
      const b = boxes[element];
      if (!b) continue;
      const w = Math.min(b.w, safe.w);
      const x = Math.min(Math.max(b.x, safe.x), safe.x + safe.w - w);
      const y = Math.min(Math.max(b.y, safe.y), safe.y + safe.h - b.h);
      if (element === 'logo') next.logo = { ...next.logo, x, y, w: Math.min(next.logo.w, safe.w) };
      else if (element === 'handle') next.handle = { ...next.handle, x, y };
      else next[element] = { ...next[element], x, y, w: Math.min(next[element].w, safe.w) };
    }
    setLayout(next);
  };
  const choosePicture = (file?: File): void => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPicture(String(reader.result));
    reader.readAsDataURL(file);
  };

  const num = (label: string, value: number, onChange: (v: number) => void, unit = '%', step = 0.5) => (
    <label className="field">
      <span className="label">{label}</span>
      <span className="unit">
        <input type="number" step={step} value={Math.round(value * 10) / 10} onChange={(e) => Number.isFinite(e.target.valueAsNumber) && onChange(e.target.valueAsNumber)} />{unit}
      </span>
    </label>
  );
  const position = (b: { x: number; y: number; w?: number }, element: Element) => (
    <div className="fields">
      {num('From left', pct(b.x), (v) => patchBox(element, { x: v / 100 }))}
      {num('From top', pct(b.y), (v) => patchBox(element, { y: v / 100 }))}
      {b.w !== undefined && num('Width', pct(b.w), (v) => patchBox(element, { w: v / 100 }))}
    </div>
  );
  const textControls = (element: 'title' | 'subtitle' | 'caption', b: TextBox) => (
    <>
      {position(b, element)}
      <div className="fields">
        {num('Size (of frame height)', b.size, (v) => patchBox(element, { size: v }), '%', 0.1)}
        <div className="field">
          <span className="label">Align</span>
          <div className="switch" role="radiogroup" aria-label="Align">
            {([['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight]] as const).map(([a, Icon]) => (
              <button key={a} type="button" role="radio" aria-checked={b.align === a} aria-selected={b.align === a} title={a} onClick={() => patchBox(element, { align: a })}><Icon size={14} /></button>
            ))}
          </div>
        </div>
      </div>
      <div className="fields">
        <label className="field">
          <span className="label">Colour</span>
          <span className="unit">
            <i className="dot" style={{ background: colorOf(kit, b.color) }} />
            <select value={b.color} onChange={(e) => patchBox(element, { color: e.target.value })}>
              {(Object.keys(COLORS) as ColorRole[]).map((r) => <option key={r} value={r}>{COLORS[r]}</option>)}
            </select>
          </span>
        </label>
        <label className="field">
          <span className="label">Letters</span>
          {element === 'caption' ? (
            <select value={kit.captions.case} onChange={(e) => update({ captions: { ...kit.captions, case: e.target.value as BrandKit['captions']['case'] } })}>
              <option value="as-spoken">As spoken</option><option value="upper">UPPERCASE</option><option value="lower">lowercase</option>
            </select>
          ) : (
            <select value={b.case} onChange={(e) => patchBox(element, { case: e.target.value })}>
              <option value="as-written">As written</option><option value="upper">UPPERCASE</option><option value="lower">lowercase</option>
            </select>
          )}
        </label>
        <label className="choice"><input type="checkbox" checked={b.italic} onChange={(e) => patchBox(element, { italic: e.target.checked })} /> Italic</label>
      </div>
      <p className="hint">{element === 'title' ? `${kit.fonts.heading.family} ${kit.fonts.heading.weight}` : `${kit.fonts.body.family} ${kit.fonts.body.weight}`} — change fonts under Typography.</p>
    </>
  );

  const inspector = (() => {
    if (!selected) return <p className="hint">Click a title, the captions, the logo or the handle tag in the frame to change it, or drag it where it should be.</p>;
    if (selected === 'logo') {
      return (
        <>
          <label className="choice"><input type="checkbox" checked={kit.watermark.on} onChange={(e) => update({ watermark: { ...kit.watermark, on: e.target.checked } })} /> Logo through the whole video</label>
          <label className="field">
            <span className="label">Which logo</span>
            <select value={kit.watermark.logo} onChange={(e) => update({ watermark: { ...kit.watermark, logo: e.target.value as LogoSlot } })}>
              {(Object.keys(LOGOS) as LogoSlot[]).map((s) => <option key={s} value={s} disabled={!kit.logos[s]}>{LOGOS[s]}{kit.logos[s] ? '' : ' (none yet)'}</option>)}
            </select>
          </label>
          {position(l.logo, 'logo')}
          <label className="field">
            <span className="label">Opacity · {Math.round(kit.watermark.opacity * 100)}%</span>
            <input type="range" min={0.2} max={1} step={0.05} value={kit.watermark.opacity} onChange={(e) => update({ watermark: { ...kit.watermark, opacity: Number(e.target.value) } })} />
          </label>
        </>
      );
    }
    if (selected === 'handle') {
      return (
        <>
          <label className="choice"><input type="checkbox" checked={l.handle.on} onChange={(e) => patchBox('handle', { on: e.target.checked })} /> Show the handle tag ({kit.identity.handle || 'set the handle under Logo'})</label>
          {position(l.handle, 'handle')}
          {num('Size (of frame height)', l.handle.size, (v) => patchBox('handle', { size: v }), '%', 0.1)}
        </>
      );
    }
    if (selected === 'caption') {
      return (
        <>
          <label className="field">
            <span className="label">Captions</span>
            <select value={kit.captions.mode} onChange={(e) => update({ captions: { ...kit.captions, mode: e.target.value as BrandKit['captions']['mode'] } })}>
              <option value="speech">When someone talks</option><option value="always">Always</option><option value="off">Never</option>
            </select>
          </label>
          {textControls('caption', l.caption)}
          <div className="fields">
            {num('Words at a time', kit.captions.words, (v) => update({ captions: { ...kit.captions, words: Math.max(1, Math.min(12, Math.round(v))) } }), '', 1)}
            <label className="choice"><input type="checkbox" checked={kit.captions.highlight} onChange={(e) => update({ captions: { ...kit.captions, highlight: e.target.checked } })} /> Highlight the word said</label>
            <label className="choice"><input type="checkbox" checked={kit.captions.outline} onChange={(e) => update({ captions: { ...kit.captions, outline: e.target.checked } })} /> Outline</label>
            <label className="choice"><input type="checkbox" checked={kit.captions.shadow} onChange={(e) => update({ captions: { ...kit.captions, shadow: e.target.checked } })} /> Shadow</label>
          </div>
        </>
      );
    }
    const b = l[selected];
    return (
      <>
        <label className="choice"><input type="checkbox" checked={b.on} onChange={(e) => patchBox(selected, { on: e.target.checked })} /> {selected === 'title' ? 'Titles in this place and style' : 'Subtitles: a second line, a name and role, a subheading'}</label>
        {textControls(selected, b)}
      </>
    );
  })();

  return (
    <div className="modal" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="layout-studio" role="dialog" aria-label="Layout studio">
        <header>
          <LayoutTemplate size={16} />
          <h2>Layout studio</h2>
          <span className="note">{kit.name} · saved as you go</span>
          <span className="spacer" />
          <div className="switch" role="tablist" aria-label="Format">
            {(Object.keys(ASPECTS) as (keyof typeof ASPECTS)[]).map((a) => (
              <button key={a} role="tab" aria-selected={aspect === a} onClick={() => setAspect(a)}>{a}</button>
            ))}
          </div>
          <button className="ghost round" aria-label="Close" onClick={onClose}><X size={16} /></button>
        </header>
        <div className="layout-body">
          <div className="layout-stage" ref={frame}>
            <LayoutFrame
              kit={kit} aspect={aspect} platform={platform} zones={zones} background={picture || undefined}
              editing={{ selected, onSelect: setSelected, onMove: move }}
            />
          </div>
          <div className="layout-side settings">
            <section>
              <h2>Apps</h2>
              <div className="fields">
                <span className="label">Keep clear of</span>
                {(Object.keys(PLATFORMS) as Platform[]).map((p) => (
                  <label key={p} className="choice">
                    <input type="checkbox" checked={l.platforms.includes(p)} onChange={(e) => setLayout({ ...l, platforms: e.target.checked ? [...l.platforms, p] : l.platforms.filter((x) => x !== p) })} />
                    {PLATFORMS[p].name}
                  </label>
                ))}
              </div>
              <div className="fields">
                <span className="label">Show on top</span>
                <div className="switch" role="tablist" aria-label="Show an app on top">
                  {(['', 'tiktok', 'reels', 'shorts'] as const).map((p) => (
                    <button key={p || 'none'} role="tab" aria-selected={platform === p} disabled={!vertical && !!p} onClick={() => setPlatform(p)}>{p ? PLATFORMS[p].name.replace('Instagram ', '').replace('YouTube ', '') : 'None'}</button>
                  ))}
                </div>
                <label className="choice"><input type="checkbox" checked={zones} onChange={(e) => setZones(e.target.checked)} /> Shade what they cover</label>
              </div>
              {!vertical && <p className="hint">The apps’ buttons only cover vertical videos (9:16).</p>}
              {clashes.length > 0 && (
                <div className="overlaps" role="status">
                  {clashes.map((c) => <p key={`${c.a}${c.b}`}><TriangleAlert size={13} /> {ELEMENT_NAMES[c.a]} and {ELEMENT_NAMES[c.b].toLowerCase()} are on top of each other</p>)}
                </div>
              )}
              {vertical && (overlaps.length ? (
                <div className="overlaps" role="status">
                  {[...new Map(overlaps.map((o) => [`${o.element}${o.platform}`, o])).values()].map((o) => (
                    <p key={`${o.element}${o.platform}`}><TriangleAlert size={13} /> {ELEMENT_NAMES[o.element]} under {PLATFORMS[o.platform].name}’s {o.what.replace(/^the /, '')}</p>
                  ))}
                  <button type="button" className="primary" onClick={fit}><ShieldCheck size={14} /> Move into the safe area</button>
                </div>
              ) : l.platforms.length ? <p className="note ok"><ShieldCheck size={13} /> Nothing is under the apps’ buttons or text.</p> : null)}
            </section>
            <section>
              <h2>{selected ? ELEMENT_NAMES[selected] : 'Elements'}</h2>
              <div className="element-tabs">
                {(Object.keys(ELEMENT_NAMES) as Element[]).map((e) => (
                  <button key={e} type="button" className={selected === e ? 'active' : ''} onClick={() => setSelected(e)}>{ELEMENT_NAMES[e]}</button>
                ))}
              </div>
              {inspector}
            </section>
            <section className="row">
              <label className="button-like">
                <ImagePlus size={14} /> Try on a picture…
                <input type="file" accept="image/*" hidden onChange={(e) => choosePicture(e.target.files?.[0])} />
              </label>
              {picture && <button type="button" className="ghost" onClick={() => setPicture('')}>Remove picture</button>}
              <span className="spacer" />
              <button type="button" className="ghost" title="Back to how it was when you opened the studio" disabled={JSON.stringify(initial.current) === JSON.stringify(l)} onClick={() => setLayout(initial.current)}><RotateCcw size={14} /> Undo changes</button>
              <button type="button" className="ghost" title="Cutroom's standard layout" onClick={() => setLayout({ ...defaultLayout(), platforms: l.platforms })}>Reset</button>
            </section>
          </div>
        </div>
      </section>
    </div>
  );
}
