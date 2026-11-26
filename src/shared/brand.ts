// Brand kits: how a video looks and sounds — logo, colours, fonts, captions, music, sound effects.
// A style (a skill) says how a video is cut; a brand kit says what it looks like. Each chat picks one.
import type { Voice } from './types';

export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export type LogoSlot = 'main' | 'mark' | 'onDark';

export interface BrandFont {
  /** Family name: of the uploaded file, a font installed on this Mac, or a Google Font. */
  family: string;
  /** Font file in the kit's folder: uploaded, or downloaded (then `source` says from where). */
  file?: string;
  weight: number;
  /** For a free font Cutroom downloaded: the library, its licence, and the family and weight of the file. */
  source?: { library: string; license: string; url: string; family: string; weight: number };
}

export type ColorRole = 'primary' | 'secondary' | 'accent' | 'text' | 'background' | 'white' | 'black';
export type Platform = 'tiktok' | 'reels' | 'shorts';

/** A block of text on screen: its box (fractions of the frame), size and look. */
export interface TextBox {
  /** Top-left of the box and its width, as fractions of the frame. */
  x: number;
  y: number;
  w: number;
  /** Font size as % of the frame height. */
  size: number;
  align: 'left' | 'center' | 'right';
  color: ColorRole;
  /** Captions take their letter case from `captions.case`. */
  case: 'as-written' | 'upper' | 'lower';
  italic: boolean;
  /** Whether the brand uses it at all. */
  on: boolean;
}

/** Where everything sits in the frame. The kit's other size and position fields follow from this. */
export interface Layout {
  title: TextBox;
  /** A second line under or near the title: a name and role, a subheading. */
  subtitle: TextBox;
  caption: TextBox;
  /** The watermark logo: top-left and width, fractions of the frame (on/off, which logo and opacity: `watermark`). */
  logo: { x: number; y: number; w: number };
  /** The handle tag (lower third). */
  handle: { x: number; y: number; size: number; on: boolean };
  /** The apps whose buttons and text must not cover anything. */
  platforms: Platform[];
}

export interface BrandKit {
  /** Folder name in `~/.cutroom/library/brands/`. */
  id: string;
  name: string;
  /** ISO time of the last change: a chat using the kit is told when it changed. */
  updatedAt: string;
  identity: { handle: string; website: string };
  /** One or two sentences about the brand: who it is, for whom, how it feels. Opens the brand guidelines. */
  about: string;
  /** Files in the kit's folder: the full logo, the icon on its own, and a version for dark backgrounds. */
  logos: Partial<Record<LogoSlot, string>>;
  watermark: { on: boolean; logo: LogoSlot; corner: Corner; /** % of the frame width */ size: number; /** 0–1 */ opacity: number };
  endCard: { on: boolean; /** The line under the logo: a URL or call to action. */ line: string };
  colors: { primary: string; secondary: string; accent: string; text: string; background: string };
  fonts: { heading: BrandFont; body: BrandFont };
  /** Text sizes, in % of the frame height (frames differ in size, so never pixels). */
  sizes: { title: number; caption: number };
  captions: {
    /** `speech`: whenever someone talks. */
    mode: 'speech' | 'always' | 'off';
    case: 'as-spoken' | 'upper' | 'lower';
    /** The word being said in the accent colour. */
    highlight: boolean;
    outline: boolean;
    shadow: boolean;
    position: 'top' | 'middle' | 'lower-third' | 'bottom';
    /** At most this many words on screen at once. */
    words: number;
  };
  /** Tracks in the kit's folder; without any, `mood` says what to find or generate. */
  music: { tracks: string[]; mood: string; /** Volume under speech, 0–1. */ level: number };
  sfx: { files: string[]; amount: 'none' | 'subtle' | 'lots' };
  look: { /** A .cube file in the kit's folder. */ lut?: string; transitions: 'cuts' | 'crossfades' | 'whips' | 'mixed'; energy: 'calm' | 'balanced' | 'punchy' };
  /** ElevenLabs voice for voice-over. */
  voice?: Voice;
  copy: { language: string; tone: string; /** Words and phrases never to use. */ avoid: string; emoji: boolean };
  /** '' = whatever suits the footage. */
  format: { aspect: '' | '9:16' | '16:9' | '1:1' | '4:5'; /** seconds, 0 = any */ length: number };
  notes: string;
  layout: Layout;
}

/** Whether a colour is dark enough to need the light version of a logo (relative luminance below 0.45). */
export function isDark(hex: string): boolean {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! < 0.45;
}

/** Whether a role's file is the font it names: a downloaded file of another family or weight is not. */
export const fontMatches = (font: BrandFont): boolean =>
  !!font.file && (!font.source || (font.source.family.toLowerCase() === font.family.trim().toLowerCase() && font.source.weight === font.weight));

/** Where a file goes in a kit. Logos and fonts take one file, music and sound effects several. */
export type BrandSlot = `logo:${LogoSlot}` | 'font:heading' | 'font:body' | 'music' | 'sfx' | 'lut';

export const BRAND_FILE_TYPES: Record<'logo' | 'font' | 'music' | 'sfx' | 'lut', { label: string; extensions: string[] }> = {
  logo: { label: 'Images', extensions: ['png', 'svg', 'jpg', 'jpeg', 'webp'] },
  font: { label: 'Fonts', extensions: ['ttf', 'otf', 'woff', 'woff2'] },
  music: { label: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'aac', 'aif', 'aiff', 'flac'] },
  sfx: { label: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'aac', 'aif', 'aiff', 'flac'] },
  lut: { label: 'LUTs', extensions: ['cube'] },
};

export const ASPECTS: Record<Exclude<BrandKit['format']['aspect'], ''>, { width: number; height: number }> = {
  '9:16': { width: 1080, height: 1920 },
  '16:9': { width: 1920, height: 1080 },
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 },
};

export const emptyBrand = (id: string, name: string): BrandKit => ({
  id,
  name,
  updatedAt: new Date().toISOString(),
  identity: { handle: '', website: '' },
  about: '',
  logos: {},
  watermark: { on: false, logo: 'mark', corner: 'top-right', size: 12, opacity: 0.85 },
  endCard: { on: true, line: '' },
  colors: { primary: '#1f6feb', secondary: '#0d1b2a', accent: '#ffd166', text: '#ffffff', background: '#101418' },
  fonts: { heading: { family: 'Inter', weight: 800 }, body: { family: 'Inter', weight: 600 } },
  sizes: { title: 7, caption: 4.5 },
  captions: { mode: 'speech', case: 'as-spoken', highlight: true, outline: false, shadow: true, position: 'lower-third', words: 4 },
  music: { tracks: [], mood: '', level: 0.15 },
  sfx: { files: [], amount: 'subtle' },
  look: { transitions: 'cuts', energy: 'balanced' },
  copy: { language: '', tone: '', avoid: '', emoji: false },
  format: { aspect: '', length: 0 },
  notes: '',
  layout: defaultLayout(),
});

const text = (x: number, y: number, w: number, size: number, align: TextBox['align'], italic = false): TextBox =>
  ({ x, y, w, size, align, color: 'text', case: 'as-written', italic, on: true });
export const defaultLayout = (): Layout => ({
  title: text(0.08, 0.14, 0.78, 7, 'left'),
  subtitle: text(0.08, 0.25, 0.78, 3, 'left', true),
  caption: text(0.08, 0.6, 0.76, 4.5, 'center'),
  logo: { x: 0.08, y: 0.085, w: 0.12 },
  handle: { x: 0.08, y: 0.5, size: 2.4, on: true },
  platforms: ['tiktok', 'reels', 'shorts'],
});

// --- Platform interfaces -------------------------------------------------------------------------------

export interface Zone {
  /** Fractions of a 9:16 frame. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** What sits there. */
  what: string;
}

/**
 * Where each app draws over a vertical video (approximate: it varies a little with the phone and app version).
 * Measured on 1080×1920: the top bar, the column of buttons on the right, and the name, caption and sound at the bottom.
 */
export const PLATFORMS: Record<Platform, { name: string; zones: Zone[] }> = {
  tiktok: {
    name: 'TikTok',
    zones: [
      { x: 0, y: 0, w: 1, h: 0.075, what: 'the Following / For You tabs' },
      { x: 0.86, y: 0.36, w: 0.14, h: 0.46, what: 'the like, comment, save and share buttons' },
      { x: 0, y: 0.79, w: 0.86, h: 0.13, what: 'the name, caption and sound' },
      { x: 0, y: 0.92, w: 1, h: 0.08, what: 'the bottom bar' },
    ],
  },
  reels: {
    name: 'Instagram Reels',
    zones: [
      { x: 0, y: 0, w: 1, h: 0.1, what: 'the Reels header and camera' },
      { x: 0.87, y: 0.48, w: 0.13, h: 0.4, what: 'the like, comment, share and more buttons' },
      { x: 0, y: 0.8, w: 0.87, h: 0.12, what: 'the name, caption and audio' },
      { x: 0, y: 0.92, w: 1, h: 0.08, what: 'the bottom bar' },
    ],
  },
  shorts: {
    name: 'YouTube Shorts',
    zones: [
      { x: 0, y: 0, w: 1, h: 0.07, what: 'the search and menu' },
      { x: 0.86, y: 0.42, w: 0.14, h: 0.44, what: 'the like, dislike, comment, share and remix buttons' },
      { x: 0, y: 0.82, w: 0.86, h: 0.11, what: 'the title, channel and Subscribe' },
      { x: 0, y: 0.93, w: 1, h: 0.07, what: 'the bottom bar' },
    ],
  },
};

/** The largest rectangle free of every chosen app's interface (fractions of the frame), with a small margin. */
export function safeArea(platforms: Platform[]): { x: number; y: number; w: number; h: number } {
  const zones = platforms.flatMap((p) => PLATFORMS[p].zones);
  const top = Math.max(0.04, ...zones.filter((z) => z.y === 0 && z.w === 1).map((z) => z.h + 0.01));
  const right = Math.min(0.96, ...zones.filter((z) => z.x > 0.5).map((z) => z.x - 0.01));
  const bottom = Math.min(0.96, ...zones.filter((z) => z.y > 0.5 && z.x === 0).map((z) => z.y - 0.01));
  const left = 0.05;
  return { x: left, y: top, w: right - left, h: bottom - top };
}

const CAPTION_Y: Record<BrandKit['captions']['position'], number> = { top: 0.12, middle: 0.44, 'lower-third': 0.6, bottom: 0.72 };

/** A layout for a kit saved before layouts existed, from its caption position, sizes and watermark corner. */
export function layoutFromLegacy(kit: BrandKit): Layout {
  const layout = defaultLayout();
  layout.title.size = kit.sizes.title;
  layout.caption.size = kit.sizes.caption;
  layout.caption.y = CAPTION_Y[kit.captions.position] ?? 0.6;
  if (layout.caption.y < 0.5) {
    layout.title.y = 0.66;
    layout.subtitle.y = 0.77;
  }
  layout.subtitle.size = Math.max(2.4, Math.round(kit.sizes.caption * 0.7 * 10) / 10);
  Object.assign(layout.logo, logoFromCorner(kit.watermark.corner, kit.watermark.size / 100));
  return layout;
}

/** The watermark's box for a corner and width (a logo about as tall as wide, in a 9:16 frame). */
export function logoFromCorner(corner: Corner, w: number): { x: number; y: number; w: number } {
  const h = (w * 9) / 16;
  return { x: corner.endsWith('left') ? 0.05 : 1 - 0.05 - w, y: corner.startsWith('top') ? 0.05 : 1 - 0.05 - h, w };
}

/** The kit's older fields (sizes, caption position, watermark corner and size) as the layout has them. */
export function syncFromLayout(kit: BrandKit): void {
  const l = kit.layout;
  kit.sizes.title = l.title.size;
  kit.sizes.caption = l.caption.size;
  type Position = BrandKit['captions']['position'];
  kit.captions.position = (Object.keys(CAPTION_Y) as Position[])
    .reduce<Position>((best, pos) => (Math.abs(CAPTION_Y[pos] - l.caption.y) < Math.abs(CAPTION_Y[best] - l.caption.y) ? pos : best), 'lower-third');
  kit.watermark.size = Math.round(l.logo.w * 100);
  kit.watermark.corner = `${l.logo.y + (l.logo.w * 9) / 32 < 0.5 ? 'top' : 'bottom'}-${l.logo.x + l.logo.w / 2 < 0.5 ? 'left' : 'right'}` as Corner;
}

/**
 * Claude (or an older kit's JSON) may set the older fields instead of the layout: carry such a change into it, so the
 * layout stays the one place positions live.
 */
export function legacyIntoLayout(kit: BrandKit, patch: Record<string, unknown>): void {
  const sub = (key: string): Record<string, unknown> => (isObject(patch[key]) ? (patch[key] as Record<string, unknown>) : {});
  if (isObject(patch.layout)) return;
  if (typeof sub('sizes').title === 'number') kit.layout.title.size = kit.sizes.title;
  if (typeof sub('sizes').caption === 'number') kit.layout.caption.size = kit.sizes.caption;
  if (typeof sub('captions').position === 'string') kit.layout.caption.y = CAPTION_Y[kit.captions.position] ?? kit.layout.caption.y;
  if ('corner' in sub('watermark') || 'size' in sub('watermark')) Object.assign(kit.layout.logo, logoFromCorner(kit.watermark.corner, kit.watermark.size / 100));
}

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Fill in whatever a kit on disk lacks (an older version, or one Claude wrote), keeping the types of the defaults. */
/** A kit from disk, an import or Claude, made whole and valid; `fixes` hears what had to be corrected. */
export function normalizeBrand(raw: unknown, id: string, fixes?: string[], patch?: Record<string, unknown>): BrandKit {
  const merge = (base: unknown, value: unknown): unknown => {
    if (isObject(base)) {
      const from = isObject(value) ? value : {};
      const out: Record<string, unknown> = {};
      for (const key of new Set([...Object.keys(base), ...Object.keys(from)])) out[key] = key in base ? merge(base[key], from[key]) : from[key];
      return out;
    }
    if (Array.isArray(base)) return Array.isArray(value) ? value.filter((v) => typeof v === 'string') : base;
    if (base === undefined) return value;
    return typeof value === typeof base ? value : base;
  };
  const kit = merge(emptyBrand(id, 'Brand kit'), raw) as BrandKit;
  kit.id = id;
  if (!kit.name.trim()) kit.name = 'Brand kit';
  repair(kit, emptyBrand(id, kit.name), fixes);
  // A kit from before layouts: its positions come from the older fields. Afterwards those follow the layout.
  if (!isObject((raw as Record<string, unknown> | null)?.layout)) kit.layout = layoutFromLegacy(kit);
  // A change to the older fields (Claude's `patch`) moves the layout.
  if (patch) legacyIntoLayout(kit, patch);
  repairLayout(kit.layout, fixes);
  syncFromLayout(kit);
  return kit;
}

/** The values each choice may take, and words people (and Claude) use for them. */
const CHOICES: { path: string; allowed: string[]; synonyms?: Record<string, string> }[] = [
  { path: 'look.transitions', allowed: ['cuts', 'crossfades', 'whips', 'mixed'], synonyms: { cut: 'cuts', hardcuts: 'cuts', fades: 'crossfades', fade: 'crossfades', crossfade: 'crossfades', dissolves: 'crossfades', dissolve: 'crossfades', softfades: 'crossfades', whip: 'whips', whippans: 'whips', mix: 'mixed' } },
  { path: 'look.energy', allowed: ['calm', 'balanced', 'punchy'], synonyms: { slow: 'calm', soft: 'calm', relaxed: 'calm', medium: 'balanced', moderate: 'balanced', fast: 'punchy', high: 'punchy', energetic: 'punchy', dynamic: 'punchy' } },
  { path: 'captions.mode', allowed: ['speech', 'always', 'off'], synonyms: { speaking: 'speech', whenspeaking: 'speech', on: 'always', none: 'off', never: 'off' } },
  { path: 'captions.case', allowed: ['as-spoken', 'upper', 'lower'], synonyms: { sentence: 'as-spoken', sentencecase: 'as-spoken', normal: 'as-spoken', uppercase: 'upper', caps: 'upper', allcaps: 'upper', lowercase: 'lower' } },
  { path: 'captions.position', allowed: ['top', 'middle', 'lower-third', 'bottom'], synonyms: { center: 'middle', centre: 'middle', lowerthird: 'lower-third' } },
  { path: 'sfx.amount', allowed: ['none', 'subtle', 'lots'], synonyms: { off: 'none', few: 'subtle', some: 'subtle', many: 'lots', heavy: 'lots' } },
  { path: 'watermark.corner', allowed: ['top-left', 'top-right', 'bottom-left', 'bottom-right'], synonyms: { topleft: 'top-left', topright: 'top-right', bottomleft: 'bottom-left', bottomright: 'bottom-right' } },
  { path: 'watermark.logo', allowed: ['main', 'mark', 'onDark'], synonyms: { icon: 'mark', full: 'main', ondark: 'onDark', light: 'onDark', white: 'onDark' } },
  { path: 'format.aspect', allowed: ['', '9:16', '16:9', '1:1', '4:5'], synonyms: { vertical: '9:16', portrait: '9:16', landscape: '16:9', horizontal: '16:9', square: '1:1' } },
];
/** Numbers and their sensible range. */
const RANGES: [string, number, number][] = [
  ['sizes.title', 2, 20], ['sizes.caption', 1.5, 12], ['captions.words', 1, 12], ['watermark.size', 2, 40], ['watermark.opacity', 0, 1],
  ['music.level', 0, 1], ['format.length', 0, 3600], ['fonts.heading.weight', 100, 900], ['fonts.body.weight', 100, 900],
];

const at = (o: unknown, path: string): unknown => path.split('.').reduce<unknown>((v, k) => (isObject(v) ? v[k] : undefined), o);
const put = (o: unknown, path: string, value: unknown): void => {
  const keys = path.split('.');
  const parent = keys.slice(0, -1).reduce<unknown>((v, k) => (isObject(v) ? v[k] : undefined), o);
  if (isObject(parent)) parent[keys.at(-1)!] = value;
};

const clamp = (v: unknown, min: number, max: number, fallback: number): number => (Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Number(v))) : fallback);

/** Keep every box inside the frame and every choice valid. */
function repairLayout(l: Layout, fixes?: string[]): void {
  const base = defaultLayout();
  for (const role of ['title', 'subtitle', 'caption'] as const) {
    const box = l[role];
    const d = base[role];
    box.w = clamp(box.w, 0.1, 1, d.w);
    box.x = clamp(box.x, 0, 1 - box.w, d.x);
    box.y = clamp(box.y, 0, 0.98, d.y);
    box.size = clamp(box.size, 1.5, 20, d.size);
    if (!['left', 'center', 'right'].includes(box.align)) box.align = d.align;
    if (!['primary', 'secondary', 'accent', 'text', 'background', 'white', 'black'].includes(box.color)) {
      fixes?.push(`layout.${role}.color "${String(box.color)}" is not one of primary, secondary, accent, text, background, white, black: set to text.`);
      box.color = 'text';
    }
    if (!['as-written', 'upper', 'lower'].includes(box.case)) box.case = 'as-written';
    box.italic = !!box.italic;
    box.on = box.on !== false;
  }
  l.logo.w = clamp(l.logo.w, 0.03, 0.6, base.logo.w);
  l.logo.x = clamp(l.logo.x, 0, 1 - l.logo.w, base.logo.x);
  l.logo.y = clamp(l.logo.y, 0, 0.97, base.logo.y);
  l.handle.x = clamp(l.handle.x, 0, 0.95, base.handle.x);
  l.handle.y = clamp(l.handle.y, 0, 0.97, base.handle.y);
  l.handle.size = clamp(l.handle.size, 1.2, 8, base.handle.size);
  l.handle.on = l.handle.on !== false;
  l.platforms = [...new Set((Array.isArray(l.platforms) ? l.platforms : base.platforms).filter((p): p is Platform => p in PLATFORMS))];
}

/** Put every choice, colour and number in a kit back within what it may be. `fixes` hears what was changed. */
function repair(kit: BrandKit, defaults: BrandKit, fixes?: string[]): void {
  for (const { path, allowed, synonyms = {} } of CHOICES) {
    const value = String(at(kit, path) ?? '');
    if (allowed.includes(value)) continue;
    const key = value.toLowerCase().replace(/[^a-z0-9:]/g, '');
    const next = allowed.find((a) => a.toLowerCase().replace(/[^a-z0-9:]/g, '') === key) ?? synonyms[key] ?? (at(defaults, path) as string);
    put(kit, path, next);
    fixes?.push(`${path} "${value}" is not one of ${allowed.map((a) => a || '""').join(', ')}: set to "${next}".`);
  }
  for (const [role, value] of Object.entries(kit.colors) as [keyof BrandKit['colors'], string][]) {
    const short = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value.trim());
    const hex = short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : `#${value.trim().replace(/^#/, '')}`;
    if (/^#[0-9a-f]{6}$/i.test(hex)) kit.colors[role] = hex.toLowerCase();
    else {
      kit.colors[role] = defaults.colors[role];
      fixes?.push(`colors.${role} "${value}" is not a #rrggbb colour: set to ${defaults.colors[role]}.`);
    }
  }
  for (const [path, min, max] of RANGES) {
    const before = at(kit, path);
    const value = Number(before);
    const next = Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : (at(defaults, path) as number);
    if (next === before) continue;
    put(kit, path, next);
    fixes?.push(`${path} ${JSON.stringify(before)} is not a number from ${min} to ${max}: set to ${next}.`);
  }
  kit.captions.words = Math.round(kit.captions.words);
  for (const role of ['heading', 'body'] as const) kit.fonts[role].weight = Math.round(kit.fonts[role].weight / 100) * 100;
}

// --- The layout in words: for the editing agent, the Markdown guidelines and the PDF ------------------------------

const pct = (v: number): string => `${Math.round(v * 1000) / 10}%`;
const COLOR_WORDS: Record<ColorRole, string> = { primary: 'primary', secondary: 'secondary', accent: 'accent', text: 'text colour', background: 'background colour', white: 'white', black: 'black' };
const hexOf = (kit: BrandKit, role: ColorRole): string => (role === 'white' ? '#ffffff' : role === 'black' ? '#000000' : kit.colors[role]);

/** One line per element: where it sits (fractions of the frame), how big and how it looks. */
export function layoutWords(kit: BrandKit): { element: string; text: string }[] {
  const l = kit.layout;
  const box = (b: TextBox, font: BrandFont, caseWord?: string): string =>
    `a ${pct(b.w)} wide box, its top-left ${pct(b.x)} from the left and ${pct(b.y)} from the top; ${b.align === 'center' ? 'centred' : `${b.align}-aligned`}; ` +
    `${font.family} ${font.weight}${b.italic ? ' italic' : ''} at ${b.size}% of the frame height; ${COLOR_WORDS[b.color]} ${hexOf(kit, b.color)}` +
    `${caseWord ?? (b.case === 'upper' ? '; UPPERCASE' : b.case === 'lower' ? '; lowercase' : '')}`;
  const c = kit.captions;
  return [
    { element: 'Title', text: l.title.on ? box(l.title, kit.fonts.heading) : 'not used' },
    { element: 'Subtitle', text: l.subtitle.on ? `${box(l.subtitle, kit.fonts.body)} — a second line: a name and role, or a subheading` : 'not used' },
    {
      element: 'Captions',
      text: c.mode === 'off' || !l.caption.on ? 'none' : `${box(l.caption, kit.fonts.body, c.case === 'upper' ? '; UPPERCASE' : c.case === 'lower' ? '; lowercase' : '')}; ` +
        `at most ${c.words} word${c.words > 1 ? 's' : ''} at a time${c.highlight ? `, the word being said in the accent colour ${kit.colors.accent}` : ''}${c.outline ? ', thin dark outline' : ''}${c.shadow ? ', soft shadow' : ''}; the box's top edge stays put as lines change`,
    },
    {
      element: 'Logo',
      text: kit.watermark.on ? `the ${kit.watermark.logo === 'mark' ? 'icon' : kit.watermark.logo === 'onDark' ? 'logo for dark backgrounds' : 'full logo'}, ${pct(l.logo.w)} of the frame width, its top-left ${pct(l.logo.x)} from the left and ${pct(l.logo.y)} from the top, opacity ${kit.watermark.opacity}, through the whole video except the end card` : 'no watermark',
    },
    { element: 'Handle tag', text: l.handle.on ? `"${kit.identity.handle || kit.name}" on the primary colour, its top-left ${pct(l.handle.x)} from the left and ${pct(l.handle.y)} from the top, text ${l.handle.size}% of the frame height` : 'not used' },
  ];
}

/** Where the chosen apps draw over vertical video, in words, and the area free of them. */
export function safeWords(kit: BrandKit): string {
  const p = kit.layout.platforms;
  if (!p.length) return '';
  const s = safeArea(p);
  return `${p.map((x) => PLATFORMS[x].name).join(', ')} draw over vertical video: the top ${pct(s.y)}, a column of buttons on the right (${pct(1 - s.x - s.w)}), and names, captions and sound at the bottom ${pct(1 - s.y - s.h)}. ` +
    `Keep text, logos and faces that matter inside ${pct(s.x)}–${pct(s.x + s.w)} across and ${pct(s.y)}–${pct(s.y + s.h)} down.`;
}

/**
 * What in a layout sits under an app's buttons or text, or on top of something else — estimated from the boxes
 * (text one line tall, captions two, a roughly square logo), for checking a layout where nothing is drawn.
 */
export function layoutProblems(kit: BrandKit): string[] {
  const l = kit.layout;
  const line = (b: TextBox, lines: number): number => (b.size / 100) * 1.2 * lines;
  const boxes: [string, { x: number; y: number; w: number; h: number }, boolean][] = [
    ['The title', { x: l.title.x, y: l.title.y, w: l.title.w, h: line(l.title, 1) + 0.02 }, l.title.on],
    ['The subtitle', { x: l.subtitle.x, y: l.subtitle.y, w: l.subtitle.w, h: line(l.subtitle, 1) }, l.subtitle.on],
    ['The captions', { x: l.caption.x, y: l.caption.y, w: l.caption.w, h: line(l.caption, 2) }, l.caption.on && kit.captions.mode !== 'off'],
    ['The logo', { x: l.logo.x, y: l.logo.y, w: l.logo.w, h: (l.logo.w * 9) / 16 }, kit.watermark.on],
    ['The handle tag', { x: l.handle.x, y: l.handle.y, w: 0.3, h: (l.handle.size / 100) * 1.6 }, l.handle.on],
  ];
  const shown = boxes.filter(([, , on]) => on);
  const problems: string[] = [];
  for (const [name, b] of shown) {
    for (const p of l.platforms) {
      const z = PLATFORMS[p].zones.find((z) => b.x < z.x + z.w && b.x + b.w > z.x && b.y < z.y + z.h && b.y + b.h > z.y);
      if (z) problems.push(`${name} is under ${PLATFORMS[p].name}'s ${z.what.replace(/^the /, '')}.`);
    }
  }
  shown.forEach(([a, p], i) => shown.slice(i + 1).forEach(([b, q]) => {
    if (Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x) > 0.01 && Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y) > 0.006) problems.push(`${a} and ${b.toLowerCase()} overlap.`);
  }));
  return problems;
}
