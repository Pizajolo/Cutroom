import { useEffect } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { Bookmark, Camera, Heart, MessageCircle, MoreHorizontal, Music2, Repeat2, Search, Send, Share2, ThumbsDown, ThumbsUp } from 'lucide-react';
import { ASPECTS, PLATFORMS, fontMatches } from '../shared/brand';
import type { BrandFont, BrandKit, ColorRole, Layout, Platform, TextBox } from '../shared/brand';

export const fileUrl = (kit: BrandKit, file: string): string => `media://brand/${kit.id}/${encodeURIComponent(file)}`;
export const fontFamily = (kit: BrandKit, role: 'heading' | 'body', font: BrandFont): string =>
  `${fontMatches(font) ? `"brand-${kit.id}-${role}", ` : ''}"${font.family}", var(--font-ui)`;

/** Load a kit's font files so frames show them. */
export function useBrandFonts(kit: BrandKit): void {
  const { heading, body } = kit.fonts;
  useEffect(() => {
    const faces = ([['heading', heading], ['body', body]] as const)
      .filter(([, font]) => fontMatches(font))
      .map(([role, font]) => new FontFace(`brand-${kit.id}-${role}`, `url("${fileUrl(kit, font.file!)}")`));
    for (const face of faces) void face.load().then(() => document.fonts.add(face), () => {});
    return () => faces.forEach((face) => document.fonts.delete(face));
  }, [kit.id, heading.file, body.file]);
}

export const colorOf = (kit: BrandKit, role: ColorRole): string => (role === 'white' ? '#ffffff' : role === 'black' ? '#000000' : kit.colors[role]);
const caseOf = (c: TextBox['case'] | BrandKit['captions']['case']): CSSProperties['textTransform'] =>
  c === 'upper' ? 'uppercase' : c === 'lower' ? 'lowercase' : 'none';

export type Element = 'title' | 'subtitle' | 'caption' | 'logo' | 'handle';
export const ELEMENT_NAMES: Record<Element, string> = { title: 'Title', subtitle: 'Subtitle', caption: 'Captions', logo: 'Logo', handle: 'Handle tag' };
const SAMPLE_WORDS = 'this is how your captions look on screen'.split(' ');

/** What drags and resizes elements, in the layout studio. */
export interface Editing {
  selected: Element | '';
  onSelect: (element: Element | '') => void;
  /** Called while dragging, with the element's new box. */
  onMove: (element: Element, patch: Partial<{ x: number; y: number; w: number; size: number }>) => void;
}

/** The interface an app draws over a vertical video, for checking that nothing important sits under it. */
function PlatformUI({ platform, kit }: { platform: Platform; kit: BrandKit }) {
  const zones = PLATFORMS[platform].zones;
  const [top, rail, info] = zones;
  const handle = kit.identity.handle || `@${kit.name.toLowerCase().replace(/[^a-z0-9]+/g, '')}`;
  const icons = platform === 'tiktok'
    ? [[Heart, '48.2K'], [MessageCircle, '1,024'], [Bookmark, '3,301'], [Share2, '812']]
    : platform === 'reels'
      ? [[Heart, '12.4K'], [MessageCircle, '318'], [Repeat2, '96'], [Send, ''], [MoreHorizontal, '']]
      : [[ThumbsUp, '24K'], [ThumbsDown, 'Dislike'], [MessageCircle, '612'], [Share2, 'Share'], [Repeat2, 'Remix']];
  const box = (z: { x: number; y: number; w: number; h: number }): CSSProperties => ({ left: `${z.x * 100}%`, top: `${z.y * 100}%`, width: `${z.w * 100}%`, height: `${z.h * 100}%` });
  return (
    <div className={`platform-ui ${platform}`} aria-hidden>
      <div className="p-top" style={box(top!)}>
        {platform === 'tiktok' && <><span>Following</span><b>For You</b><Search size="2.6cqh" /></>}
        {platform === 'reels' && <><b>Reels</b><Camera size="2.8cqh" /></>}
        {platform === 'shorts' && <><Search size="2.6cqh" /><MoreHorizontal size="2.6cqh" /></>}
      </div>
      <div className="p-rail" style={box(rail!)}>
        {platform === 'tiktok' && <span className="avatar" style={{ background: kit.colors.primary }} />}
        {icons.map(([Icon, label], i) => {
          const I = Icon as typeof Heart;
          return <span key={i}><I size="3.4cqh" />{label && <small>{label as string}</small>}</span>;
        })}
        <span className="disc"><Music2 size="2.2cqh" /></span>
      </div>
      <div className="p-info" style={box(info!)}>
        <b>{handle}{platform === 'shorts' && <em>Subscribe</em>}</b>
        <span>The caption people write under the video, cut off after a line…</span>
        <span className="sound"><Music2 size="1.6cqh" /> original sound · {kit.name}</span>
      </div>
    </div>
  );
}

/**
 * A video frame in the kit's look with everything where its layout puts it. With `editing`, elements can be
 * selected, dragged and resized; with `platform`, that app's interface is drawn on top; `zones` shades where the
 * chosen apps draw.
 */
export function LayoutFrame({ kit, layout = kit.layout, aspect, platform, zones, editing, background, children }: {
  kit: BrandKit;
  layout?: Layout;
  aspect?: keyof typeof ASPECTS;
  platform?: Platform | '';
  zones?: boolean;
  editing?: Editing;
  /** Behind everything: a picture of footage, or the kit's colours. */
  background?: string;
  children?: ReactNode;
}) {
  useBrandFonts(kit);
  const size = ASPECTS[aspect ?? (kit.format.aspect || '9:16')];
  const vertical = size.height > size.width;
  const heading: CSSProperties = { fontFamily: fontFamily(kit, 'heading', kit.fonts.heading), fontWeight: kit.fonts.heading.weight };
  const body: CSSProperties = { fontFamily: fontFamily(kit, 'body', kit.fonts.body), fontWeight: kit.fonts.body.weight };
  const c = kit.captions;
  const words = SAMPLE_WORDS.slice(0, Math.max(1, c.words));
  const mark = kit.logos[kit.watermark.logo];

  /** Drag the element (or, from a handle, resize it), in fractions of the frame. */
  const drag = (element: Element, mode: 'move' | 'width' | 'size') => (e: ReactPointerEvent) => {
    if (!editing) return;
    e.stopPropagation();
    e.preventDefault();
    editing.onSelect(element);
    const frame = (e.currentTarget as HTMLElement).closest('.layout-frame')!.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY };
    const from = element === 'logo' ? { ...layout.logo, size: 0 }
      : element === 'handle' ? { x: layout.handle.x, y: layout.handle.y, w: 0, size: layout.handle.size }
      : { x: layout[element].x, y: layout[element].y, w: layout[element].w, size: layout[element].size };
    const move = (ev: PointerEvent): void => {
      const dx = (ev.clientX - start.x) / frame.width;
      const dy = (ev.clientY - start.y) / frame.height;
      // Snap to the centre line and to 1% steps, so things line up.
      const snap = (v: number, centre?: number): number => (centre !== undefined && Math.abs(v - centre) < 0.012 ? centre : Math.round(v * 200) / 200);
      if (mode === 'move') editing.onMove(element, { x: snap(from.x + dx, from.w ? 0.5 - from.w / 2 : undefined), y: snap(from.y + dy) });
      else if (mode === 'width') editing.onMove(element, { w: Math.max(0.08, Math.round((from.w + dx) * 200) / 200) });
      else if (element === 'logo') editing.onMove(element, { w: Math.max(0.03, Math.round((from.w + dx) * 200) / 200) });
      else editing.onMove(element, { size: Math.max(1.2, Math.round((from.size + dy * 100) * 10) / 10) });
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const wrap = (element: Element, style: CSSProperties, content: ReactNode, handles: ('width' | 'size')[]) => (
    <div
      key={element}
      className={`el el-${element}${editing?.selected === element ? ' selected' : ''}${editing ? ' editable' : ''}`}
      data-element={element}
      style={style}
      onPointerDown={editing ? drag(element, 'move') : undefined}
      title={editing ? `${ELEMENT_NAMES[element]}: drag to move` : undefined}
    >
      {content}
      {editing?.selected === element && handles.map((h) => (
        <span key={h} className={`grip grip-${h}`} title={h === 'width' ? 'Drag to change the width' : element === 'logo' ? 'Drag to resize' : 'Drag up or down for the text size'} onPointerDown={drag(element, h)} />
      ))}
    </div>
  );
  const text = (element: 'title' | 'subtitle' | 'caption', content: ReactNode, font: CSSProperties) => {
    const b = layout[element];
    if (!b.on && !editing) return null;
    return wrap(element, {
      ...font, left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, fontSize: `${b.size}cqh`, textAlign: b.align,
      color: colorOf(kit, b.color), fontStyle: b.italic ? 'italic' : undefined, opacity: b.on ? 1 : 0.35,
      textTransform: caseOf(element === 'caption' ? c.case : b.case),
      ...(element === 'caption' && c.shadow ? { textShadow: '0 0.3cqh 1.2cqh rgb(0 0 0 / 65%)' } : {}),
      ...(element === 'caption' && c.outline ? { WebkitTextStroke: '0.18cqh rgb(0 0 0 / 85%)', paintOrder: 'stroke fill' } : {}),
    }, content, element === 'caption' || element === 'title' || element === 'subtitle' ? ['width', 'size'] : []);
  };

  return (
    <div
      className={`layout-frame${editing ? ' editing' : ''}`}
      style={{ aspectRatio: `${size.width} / ${size.height}`, background: background ? `center / cover no-repeat url("${background}")` : undefined, '--bg': kit.colors.background, '--secondary': kit.colors.secondary } as CSSProperties}
      onPointerDown={() => editing?.onSelect('')}
    >
      {zones && vertical && (
        <div className="zones" aria-hidden>
          {layout.platforms.flatMap((p) => PLATFORMS[p].zones.map((z, i) => (
            <i key={`${p}${i}`} style={{ left: `${z.x * 100}%`, top: `${z.y * 100}%`, width: `${z.w * 100}%`, height: `${z.h * 100}%` }} />
          )))}
        </div>
      )}
      {text('title', <>Your title<span className="underline" style={{ background: kit.colors.accent }} /></>, heading)}
      {text('subtitle', 'A subtitle — a name and role', body)}
      {(layout.handle.on || editing) && wrap('handle', {
        ...body, left: `${layout.handle.x * 100}%`, top: `${layout.handle.y * 100}%`, fontSize: `${layout.handle.size}cqh`,
        background: kit.colors.primary, color: colorOf(kit, 'text') === kit.colors.primary ? '#fff' : colorOf(kit, 'text'), opacity: layout.handle.on ? 1 : 0.35,
      }, kit.identity.handle || kit.name, ['size'])}
      {c.mode !== 'off' && text('caption', words.map((word, i) => (
        <span key={i} style={c.highlight && i === Math.min(2, words.length - 1) ? { color: kit.colors.accent } : undefined}>{word} </span>
      )), body)}
      {(kit.watermark.on || editing) && wrap('logo', { left: `${layout.logo.x * 100}%`, top: `${layout.logo.y * 100}%`, width: `${layout.logo.w * 100}%`, opacity: kit.watermark.on ? kit.watermark.opacity : 0.35 },
        mark ? <img src={fileUrl(kit, mark)} alt="" draggable={false} /> : <span className="no-logo">Logo</span>, ['size'])}
      {platform && vertical && <PlatformUI platform={platform} kit={kit} />}
      {children}
    </div>
  );
}

/** Where each element is in the frame, measured on screen (fractions), for checking it against the apps' interfaces. */
export function measure(frame: HTMLElement): Partial<Record<Element, { x: number; y: number; w: number; h: number }>> {
  const f = frame.getBoundingClientRect();
  const out: Partial<Record<Element, { x: number; y: number; w: number; h: number }>> = {};
  frame.querySelectorAll<HTMLElement>('[data-element]').forEach((el) => {
    const r = el.getBoundingClientRect();
    out[el.dataset.element as Element] = { x: (r.left - f.left) / f.width, y: (r.top - f.top) / f.height, w: r.width / f.width, h: r.height / f.height };
  });
  return out;
}
