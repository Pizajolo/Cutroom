// A brand kit as files for other people: brand guidelines as PDF (laid out like a designer's identity manual) and as
// Markdown, and a brand package (.zip) with everything — the kit and its files, both documents and design tokens —
// that Cutroom can import again.
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BrowserWindow } from 'electron';
import { unzipSync, zipSync } from 'fflate';
import { ASPECTS, PLATFORMS, fontMatches, layoutWords, normalizeBrand, safeWords } from '../shared/brand';
import type { BrandFont, BrandKit, ColorRole, LogoSlot, TextBox } from '../shared/brand';
import { brandDir, brandFiles, listBrands, newBrandId, saveBrand } from './brands';

// --- Colour arithmetic ---------------------------------------------------------------------------------

const channels = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const luminance = (hex: string): number => {
  const [r, g, b] = channels(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
/** Ink that reads on a colour. */
const inkOn = (hex: string): string => (luminance(hex) > 0.45 ? '#1d1c1a' : '#ffffff');
/** A naive CMYK, for orientation only: print needs proofs. */
function cmyk(hex: string): string {
  const [r, g, b] = channels(hex).map((v) => v / 255) as [number, number, number];
  const k = 1 - Math.max(r, g, b);
  if (k >= 1) return '0, 0, 0, 100';
  return [(1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k].map((v) => Math.round(v * 100)).join(', ');
}

const ROLES: { key: keyof BrandKit['colors']; name: string; use: string }[] = [
  { key: 'primary', name: 'Primary', use: 'The brand colour: end card, lower thirds, large areas.' },
  { key: 'secondary', name: 'Secondary', use: 'Supports the primary: panels, shapes, second backgrounds.' },
  { key: 'accent', name: 'Accent', use: 'Highlights only: the word being said, underlines, small details.' },
  { key: 'text', name: 'Text', use: 'Titles and captions on the background colour.' },
  { key: 'background', name: 'Background', use: 'Behind titles and on cards when there is no footage.' },
];
const LOGOS: Record<LogoSlot, { name: string; use: string }> = {
  main: { name: 'Full logo', use: 'The complete logo. End cards, intros and anywhere there is room for it.' },
  mark: { name: 'Icon', use: 'The mark on its own. Watermarks, avatars and small spaces.' },
  onDark: { name: 'Logo for dark backgrounds', use: 'The light version, on dark footage and dark colours.' },
};

const esc = (text: unknown): string => String(text ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2',
};
const dataUrl = async (kit: BrandKit, file: string): Promise<string> =>
  `data:${MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream'};base64,${(await readFile(path.join(brandDir(kit.id), file))).toString('base64')}`;

// --- Words used in both documents ----------------------------------------------------------------------

const motionWords = (kit: BrandKit): [string, string][] => [
  ['Transitions', { cuts: 'Hard cuts.', crossfades: 'Short crossfades.', whips: 'Whip pans and fast pushes.', mixed: 'Mostly cuts, an occasional crossfade or whip.' }[kit.look.transitions]],
  ['Energy', { calm: 'Calm: long shots, slow moves, room to breathe.', balanced: 'Balanced: steady rhythm, nothing rushed.', punchy: 'Punchy: quick cuts, fast titles, constant movement.' }[kit.look.energy]],
  ['Format', kit.format.aspect ? `${kit.format.aspect} (${ASPECTS[kit.format.aspect].width}×${ASPECTS[kit.format.aspect].height})` : 'Whatever suits the footage and platform.'],
  ['Length', kit.format.length ? `About ${kit.format.length} seconds.` : 'As long as the story needs.'],
  ['Colour look', kit.look.lut ? `The ${kit.look.lut} LUT on the whole video, after correcting each shot.` : 'Natural colour, shots matched to each other.'],
];
const soundWords = (kit: BrandKit): [string, string][] => [
  ['Music', kit.music.tracks.length ? `${kit.music.tracks.join(', ')}${kit.music.mood ? ` — ${kit.music.mood}` : ''}` : kit.music.mood || 'No preference.'],
  ['Level', `Music at ${Math.round(kit.music.level * 100)}% under speech; louder where nobody talks.`],
  ['Sound effects', { none: 'None.', subtle: 'Subtle: only on a few key moments.', lots: 'Many: on cuts, titles and pop-ups.' }[kit.sfx.amount] + (kit.sfx.files.length ? ` Brand sounds: ${kit.sfx.files.join(', ')}.` : '')],
  ['Voice-over', kit.voice ? `The voice "${kit.voice.name}".` : 'No set voice.'],
];
/** "es" → "Spanish", "en, no" → "English, Norwegian"; names that are not codes stay as written. */
function languageName(value: string): string {
  const names = new Intl.DisplayNames(['en'], { type: 'language' });
  return value.split(/\s*[,/]\s*/).filter(Boolean).map((part) => {
    if (!/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(part)) return part;
    try {
      return names.of(part) ?? part;
    } catch {
      return part;
    }
  }).join(', ');
}
const voiceWords = (kit: BrandKit): [string, string][] => [
  ['Language', languageName(kit.copy.language) || 'The language of the footage.'],
  ['Tone', kit.copy.tone || '—'],
  ['Never say', kit.copy.avoid || '—'],
  ['Emoji', kit.copy.emoji ? 'Fine, sparingly.' : 'None in text on screen.'],
];
const logoRules = (kit: BrandKit): string[] => [
  'Never stretch, squash, rotate or crop the logo.',
  'Never recolour it, or add shadows, outlines or effects.',
  'Keep clear space around it: at least the height of the icon.',
  `On photos and busy footage, use the ${kit.logos.onDark ? 'light version' : 'logo in white or black'}, whichever reads best.`,
  kit.watermark.on
    ? `Watermark: the ${LOGOS[kit.watermark.logo].name.toLowerCase()} in the ${kit.watermark.corner.replace('-', ' ')} corner, ${kit.watermark.size}% of the frame width, ${Math.round(kit.watermark.opacity * 100)}% opacity, for the whole video except the end card.`
    : 'No watermark during the video.',
  kit.endCard.on ? `Every video ends on the logo${kit.endCard.line ? ` with “${kit.endCard.line}”` : ''}, 1.5–2.5 seconds.` : 'No end card.',
];

/** " · OFL-1.1 · Google Fonts" for a downloaded free font. */
const licence = (f: BrandFont): string => (f.source && fontMatches(f) ? ` · free font, ${f.source.license}, ${f.source.library}` : '');

// --- Brand guidelines: HTML, printed to PDF ---------------------------------------------------------------

/** Font faces for the kit's fonts: uploaded files embedded, other families from Google Fonts. */
async function fontCss(kit: BrandKit): Promise<{ css: string; links: string; heading: string; body: string }> {
  let css = '';
  const google: BrandFont[] = [];
  const family = async (role: 'heading' | 'body', font: BrandFont): Promise<string> => {
    if (fontMatches(font) && existsSync(path.join(brandDir(kit.id), font.file!))) {
      css += `@font-face { font-family: 'kit-${role}'; src: url('${await dataUrl(kit, font.file!)}'); }\n`;
      return `'kit-${role}', '${font.family.replace(/'/g, '')}', Georgia, serif`;
    }
    google.push(font);
    return `'${font.family.replace(/'/g, '')}', 'Helvetica Neue', Arial, sans-serif`;
  };
  const heading = await family('heading', kit.fonts.heading);
  const body = await family('body', kit.fonts.body);
  const families = [...new Set(google.map((f) => f.family))].map((name) => {
    const weights = [...new Set([400, ...google.filter((f) => f.family === name).map((f) => f.weight)])].sort((a, b) => a - b);
    return `family=${encodeURIComponent(name).replace(/%20/g, '+')}:ital,wght@${[...weights.map((w) => `0,${w}`), ...weights.map((w) => `1,${w}`)].join(';')}`;
  });
  const links = families.length ? `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${families.join('&')}&display=block">` : '';
  return { css, links, heading, body };
}

export async function guidelinesHtml(kit: BrandKit): Promise<string> {
  const c = kit.colors;
  const fonts = await fontCss(kit);
  const logos = Object.fromEntries(await Promise.all((Object.entries(kit.logos) as [LogoSlot, string][]).filter(([, f]) => existsSync(path.join(brandDir(kit.id), f))).map(async ([slot, f]) => [slot, await dataUrl(kit, f)]))) as Partial<Record<LogoSlot, string>>;
  // The manual's own paper and ink: the kit's lightest colour if it is light enough, else a warm off-white.
  const lightest = Object.values(c).sort((a, b) => luminance(b) - luminance(a))[0]!;
  const paper = luminance(lightest) > 0.75 ? lightest : '#f6f3ef';
  const ink = '#1d1c1a';
  const line = luminance(c.primary) < 0.6 ? c.primary : c.secondary;
  const anyLogo = logos.main ?? logos.mark ?? logos.onDark;
  const iconish = logos.mark ?? logos.main ?? logos.onDark;
  const name = esc(kit.name);
  const handle = esc(kit.identity.handle || kit.identity.website || kit.name);
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  let pageNo = 0;

  const page = (body: string, options: { bg?: string; bare?: boolean } = {}): string => {
    pageNo++;
    const bg = options.bg ?? paper;
    const fg = inkOn(bg);
    if (options.bare) return `<section class="page" style="background:${bg};color:${fg}">${body}</section>`;
    return `<section class="page" style="background:${bg};color:${fg}">
      <header><span>${handle}</span><span>Brand guidelines · ${name}</span></header>
      ${body}
      <footer>${String(pageNo).padStart(2, '0')}</footer></section>`;
  };
  const head = (title: string, text: string, note = ''): string => `
    <div class="head"><h2>${title}</h2><p>${text}</p><p class="note">${note}</p></div>`;
  const divider = (n: number, title: string, items: string[]): string => page(`
    <div class="divider"><span class="numeral">${n}.</span><div><h3>${title}</h3><i></i>${items.map((t, i) => `<p>${n}.${i + 1} ${t}</p>`).join('')}</div></div>`);
  const table = (rows: [string, string][]): string => `<dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
  const logoImg = (src: string | undefined, css = ''): string => (src ? `<img src="${src}" style="${css}">` : `<strong style="font-family:${fonts.heading};font-weight:${kit.fonts.heading.weight};font-size:22pt;${css}">${name}</strong>`);
  /**
   * The logo that reads on a background: on dark colours the light version, on light ones the full logo (or icon). With
   * no light version, a dark background gets the name in the heading font — recolouring the logo is what the rules forbid.
   */
  const logoOn = (bg: string, css: string, prefer: 'main' | 'mark' = 'main'): string => {
    const dark = luminance(bg) < 0.45;
    const src = dark ? logos.onDark : prefer === 'mark' ? (logos.mark ?? logos.main) : (logos.main ?? logos.mark);
    return src ? `<img src="${src}" style="${css}">` : `<strong class="wordmark" style="font-family:${fonts.heading};font-weight:${kit.fonts.heading.weight};color:${inkOn(bg)}">${name}</strong>`;
  };

  // A 9:16 frame in the kit's look, as on the kit's page in Cutroom.
  const aspect = ASPECTS[kit.format.aspect || '9:16'];
  const frame = (inner: string, bg = `linear-gradient(160deg, ${c.secondary}, ${c.background} 60%)`): string =>
    `<div class="frame" style="aspect-ratio:${aspect.width}/${aspect.height};background:${bg}">${inner}</div>`;
  const words = 'this is how captions look on screen'.split(' ').slice(0, Math.max(1, kit.captions.words));
  const L = kit.layout;
  const color = (role: ColorRole): string => (role === 'white' ? '#ffffff' : role === 'black' ? '#000000' : c[role]);
  const textCase = (v: string): string => (v === 'upper' ? 'uppercase' : v === 'lower' ? 'lowercase' : 'none');
  const box = (b: TextBox, font: string, weight: number, extra = ''): string =>
    `left:${b.x * 100}%;top:${b.y * 100}%;width:${b.w * 100}%;text-align:${b.align};font-family:${font};font-weight:${weight};font-size:${b.size}cqh;color:${color(b.color)};${b.italic ? 'font-style:italic;' : ''}${extra}`;
  const markSrc = logos[kit.watermark.logo];
  /** A frame with everything where the layout puts it; `zones` shades where the chosen apps draw. */
  const layoutFrame = (zones: boolean): string => frame(`
    ${zones && aspect.height > aspect.width ? L.platforms.flatMap((p) => PLATFORMS[p].zones).map((z) => `<i class="f-zone" style="left:${z.x * 100}%;top:${z.y * 100}%;width:${z.w * 100}%;height:${z.h * 100}%"></i>`).join('') : ''}
    ${L.title.on ? `<div class="f-title" style="${box(L.title, fonts.heading, kit.fonts.heading.weight, `text-transform:${textCase(L.title.case)};`)}">Your title<i style="background:${c.accent};${L.title.align === 'center' ? 'margin-inline:auto;' : L.title.align === 'right' ? 'margin-left:auto;' : ''}"></i></div>` : ''}
    ${L.subtitle.on ? `<div class="f-sub" style="${box(L.subtitle, fonts.body, kit.fonts.body.weight, `text-transform:${textCase(L.subtitle.case)};`)}">A subtitle — a name and role</div>` : ''}
    ${L.handle.on ? `<div class="f-lower" style="left:${L.handle.x * 100}%;top:${L.handle.y * 100}%;font-size:${L.handle.size}cqh;font-family:${fonts.body};background:${c.primary};color:${inkOn(c.primary)}">${handle}</div>` : ''}
    ${kit.captions.mode === 'off' || !L.caption.on ? '' : `<p class="f-caption" style="${box(L.caption, fonts.body, kit.fonts.body.weight, `text-transform:${textCase(kit.captions.case)};${kit.captions.shadow ? 'text-shadow:0 .25cqh 0 rgb(0 0 0/.35);' : ''}${kit.captions.outline ? '-webkit-text-stroke:.18cqh rgb(0 0 0/.85);paint-order:stroke fill;' : ''}`)}">${words.map((w, i) => `<span${kit.captions.highlight && i === Math.min(2, words.length - 1) ? ` style="color:${c.accent}"` : ''}>${esc(w)}</span>`).join(' ')}</p>`}
    ${kit.watermark.on && markSrc ? `<img class="f-mark" src="${markSrc}" style="left:${L.logo.x * 100}%;top:${L.logo.y * 100}%;width:${L.logo.w * 100}%;opacity:${kit.watermark.opacity}">` : ''}`);
  const watermarkFrame = layoutFrame(false);
  const endFrame = frame(`<div class="f-end">${logoOn(c.primary, 'width:34%;max-height:30%;object-fit:contain')}${kit.endCard.line ? `<span style="font-family:${fonts.body};color:${inkOn(c.primary)}">${esc(kit.endCard.line)}</span>` : ''}</div>`, c.primary);

  const pages: string[] = [];
  // Cover and introduction.
  // The cover is the brand colour when the logo reads on it, else the paper.
  const coverBg = luminance(c.primary) < 0.45 && !logos.onDark && anyLogo ? paper : c.primary;
  pages.push(page(`<div class="cover">${logoOn(coverBg, 'max-width:42%;max-height:34%;object-fit:contain')}<p style="font-family:${fonts.body}">Brand guidelines</p></div>`, { bg: coverBg, bare: true }));
  pages.push(page(`
    <div class="intro">
      <h1 style="color:${line}">${name}</h1>
      <h4>Brand guidelines for video</h4><i style="background:${line}"></i>
      <p>${esc(kit.about.trim() || `How ${kit.name} looks and sounds in video: its logo, colours, typography, captions, motion, sound and words, and how to use them.`)}</p>
      <p class="small">${[kit.identity.website, kit.identity.handle].filter(Boolean).map(esc).join(' · ')}${kit.identity.website || kit.identity.handle ? '<br>' : ''}Made with Cutroom · ${today}</p>
    </div>`, { bare: true }));
  // Cover, introduction and contents come first; then each section starts with its divider.
  const logoPages = Math.max(1, Object.keys(logos).length) + 1;
  const colourStart = 4 + 1 + logoPages;
  const videoStart = colourStart + 1 + (iconish ? 3 : 2);
  const num = (n: number): string => String(n).padStart(2, '0');
  pages.push(page(`${head('Contents', '')}<ol class="toc"><li>1. Logo<span>04</span></li><li>2. Colour and type<span>${num(colourStart)}</span></li><li>3. Video<span>${num(videoStart)}</span></li></ol>`));

  // 1. Logo.
  pages.push(divider(1, 'Logo', [...(Object.keys(logos) as LogoSlot[]).map((s) => LOGOS[s].name), 'Usage']));
  for (const slot of ['main', 'mark', 'onDark'] as LogoSlot[]) {
    if (!logos[slot]) continue;
    const bg = slot === 'onDark' ? (luminance(c.background) < 0.3 ? c.background : '#1d1c1a') : paper;
    pages.push(page(`${head(`1.${pages.length - 3} ${LOGOS[slot].name}`, LOGOS[slot].use)}<div class="stage" style="background:${bg}">${logoImg(logos[slot], 'max-width:44%;max-height:70%;object-fit:contain')}</div>`));
  }
  if (!anyLogo) pages.push(page(`${head('1.1 Logo', 'No logo in the kit yet. Add it in Cutroom under Brand kits.')}`));
  pages.push(page(`${head('Logo usage', 'How the logo appears in video, and what never to do with it.')}
    <div class="split"><div class="frames">${watermarkFrame}${endFrame}</div><ul class="rules">${logoRules(kit).map((r) => `<li>${esc(r)}</li>`).join('')}</ul></div>`));

  // 2. Colour and type.
  pages.push(divider(2, 'Colour and type', ['Palette', 'Colour combinations', 'Typography']));
  pages.push(page(`${head('2.1 Palette', 'The brand colours and what each one is for.', 'Colours shift between screens and print. CMYK values are approximate: ask for print proofs.')}
    <div class="swatches">${ROLES.map((r) => `<div style="background:${c[r.key]};color:${inkOn(c[r.key])}"><b>${r.name}</b><small>${esc(r.use)}</small><span>HEX ${c[r.key].toUpperCase()}<br>RGB ${channels(c[r.key]).join(', ')}<br>CMYK ${cmyk(c[r.key])}</span></div>`).join('')}</div>`));
  if (iconish) {
    pages.push(page(`${head('2.2 Colour combinations', 'The logo on each brand colour.', logos.onDark ? 'Dark colours take the light version of the logo.' : 'Dark colours need a light version of the logo: add one under Brand kits (the pencil makes it).')}
      <div class="combos">${ROLES.map((r) => `<div style="background:${c[r.key]}">${logoOn(c[r.key], 'max-width:60%;max-height:46%;object-fit:contain', 'mark')}</div>`).join('')}</div>`));
  }
  const specimen = 'Aa Bb Cc Dd Ee Ff Gg Hh Ii Jj Kk Ll Mm Nn Ññ Oo Pp Qq Rr Ss Tt Uu Vv Ww Xx Yy Zz 0123456789';
  pages.push(page(`${head(`2.${iconish ? 3 : 2} Typography`, 'The typefaces for every word on screen.', `Sizes are a share of the frame height, so they hold in every format.`)}
    <div class="type">
      <div><h5>Titles and short phrases</h5><div class="big" style="font-family:${fonts.heading};font-weight:${kit.fonts.heading.weight}">${esc(kit.fonts.heading.family)}</div>
        <p class="spec" style="font-family:${fonts.heading};font-weight:${kit.fonts.heading.weight}">${specimen}</p><p class="meta">Weight ${kit.fonts.heading.weight} · about ${kit.sizes.title}% of the frame height${licence(kit.fonts.heading)}</p></div>
      <div><h5>Captions and body text</h5><div class="big" style="font-family:${fonts.body};font-weight:${kit.fonts.body.weight}">${esc(kit.fonts.body.family)}</div>
        <p class="spec" style="font-family:${fonts.body};font-weight:${kit.fonts.body.weight}">${specimen}</p><p class="meta">Weight ${kit.fonts.body.weight} · about ${kit.sizes.caption}% of the frame height${licence(kit.fonts.body)}</p></div>
      <div class="example"><h5>Example</h5><div style="font-family:${fonts.heading};font-weight:${kit.fonts.heading.weight};font-size:24pt;line-height:1.05">THIS IS A TITLE</div>
        <p style="font-family:${fonts.body};font-weight:${kit.fonts.body.weight};font-size:11pt">And this is how a caption reads under it.</p></div>
    </div>`));

  // 3. Video.
  pages.push(divider(3, 'Video', ['Layout and captions', 'Motion', 'Sound', 'Voice and words']));
  const apps = safeWords(kit);
  pages.push(page(`${head('3.1 Layout and captions', 'Where words and the logo sit, and how they look. Positions are shares of the frame, so they hold in every format.', apps ? 'Shaded: what the apps draw over vertical video.' : '')}
    <div class="split"><div class="frames one">${layoutFrame(true)}</div>
    <dl class="layout-list">${layoutWords(kit).map((w) => `<dt>${esc(w.element)}</dt><dd>${esc(w.text.replace(/^./, (m) => m.toUpperCase()))}.</dd>`).join('')}${apps ? `<dt>Apps</dt><dd>${esc(apps)}</dd>` : ''}</dl></div>`));
  pages.push(page(`${head('3.2 Motion and 3.3 Sound', 'The rhythm of the cut, and what we hear.')}<div class="cols">${table(motionWords(kit))}${table(soundWords(kit))}</div>`));
  pages.push(page(`${head('3.4 Voice and words', 'How the brand talks, in titles, captions and voice-over.')}<div class="cols">${table(voiceWords(kit))}${kit.notes.trim() ? `<div><h5>Notes</h5><p class="notes">${esc(kit.notes.trim()).replace(/\n/g, '<br>')}</p></div>` : '<div></div>'}</div>`));
  // Closing page: the logo on the brand colour, as the cover.
  pages.push(page(`<div class="cover">${logoOn(coverBg, 'max-width:26%;max-height:22%;object-fit:contain')}${kit.endCard.line || kit.identity.website ? `<p style="font-family:${fonts.body}">${esc(kit.endCard.line || kit.identity.website)}</p>` : ''}</div>`, { bg: coverBg, bare: true }));

  return `<!doctype html><html><head><meta charset="utf-8">${fonts.links}<style>
${fonts.css}
@page { size: 297mm 210mm; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: ${fonts.body}; color: ${ink}; }
.page { width: 297mm; height: 210mm; position: relative; overflow: hidden; page-break-after: always; padding: 0 12mm; }
.page > header { display: flex; justify-content: space-between; padding: 13mm 0 7mm; border-bottom: .35mm solid ${line}; font-size: 6.5pt; letter-spacing: .18em; text-transform: uppercase; }
.page > footer { position: absolute; right: 12mm; bottom: 10mm; font-size: 9pt; letter-spacing: .12em; }
.head { display: grid; grid-template-columns: 62mm 1fr 1fr; gap: 10mm; padding: 9mm 0; border-bottom: .35mm solid ${line}; }
.head h2 { margin: 0; font-size: 10pt; letter-spacing: .2em; text-transform: uppercase; font-weight: 700; }
.head p { margin: 0; font-size: 8pt; line-height: 1.55; letter-spacing: .03em; }
.cover { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8mm; }
.cover p { margin: 0; font-size: 9pt; letter-spacing: .32em; text-transform: uppercase; }
.intro { position: absolute; right: 22mm; bottom: 26mm; width: 92mm; }
.intro h1 { margin: 0 0 5mm; font-family: ${fonts.heading}; font-weight: ${kit.fonts.heading.weight}; font-size: 22pt; letter-spacing: .04em; text-transform: uppercase; line-height: 1.1; }
.intro h4 { margin: 0; font-size: 8pt; letter-spacing: .3em; text-transform: uppercase; }
.intro i { display: block; height: .35mm; margin: 6mm 0; }
.intro p { font-size: 8.5pt; line-height: 1.7; letter-spacing: .04em; }
.intro .small { font-size: 7pt; opacity: .75; }
.toc { list-style: none; margin: 10mm 0 0; padding: 0; }
.toc li { display: flex; justify-content: space-between; padding: 3mm 0; font-size: 9pt; letter-spacing: .22em; text-transform: uppercase; }
.divider { position: absolute; left: 22mm; bottom: 26mm; display: flex; align-items: flex-end; gap: 12mm; }
.divider .numeral { font-family: ${fonts.heading}; font-size: 110pt; line-height: .8; color: ${line}; }
.divider h3 { margin: 0; font-size: 9pt; letter-spacing: .3em; text-transform: uppercase; font-weight: 500; }
.divider i { display: block; width: 26mm; height: .35mm; margin: 4mm 0; background: ${line}; }
.divider p { margin: 1.5mm 0 0; font-size: 7.5pt; letter-spacing: .2em; text-transform: uppercase; }
.stage { position: absolute; left: 12mm; right: 12mm; top: 66mm; bottom: 22mm; display: flex; align-items: center; justify-content: center; border-radius: 2mm; }
.split { display: grid; grid-template-columns: auto 1fr; gap: 16mm; align-items: center; margin-top: 12mm; }
.frames { display: flex; gap: 6mm; height: 104mm; }
.frame { position: relative; height: 100%; overflow: hidden; border-radius: 2mm; container-type: size; box-shadow: 0 0 0 .2mm rgb(0 0 0 / 10%); }
.frame > * { position: absolute; }
.f-title { line-height: 1.05; }
.f-sub { line-height: 1.15; }
.f-zone { background: repeating-linear-gradient(135deg, rgb(229 72 77 / 26%) 0 1.2mm, rgb(229 72 77 / 10%) 1.2mm 2.4mm); }
.layout-list { grid-template-columns: 26mm 1fr; max-width: 150mm; }
.layout-list dd { font-size: 8pt; }
.f-title i { display: block; width: 30%; height: .8cqh; margin-top: 1.4cqh; border-radius: 1cqh; }
.f-caption { margin: 0; line-height: 1.15; }
.f-lower { padding: .9cqh 2.4cqw; border-radius: .6cqh; white-space: nowrap; }
.f-mark { object-fit: contain; }
.f-end { inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2.5cqh; }
.f-end > * { position: static; }
.f-end span { font-size: 3.4cqh; }
.rules { margin: 0; padding: 0; list-style: none; max-width: 120mm; }
.rules li { padding: 2.6mm 0; border-bottom: .2mm solid ${line}44; font-size: 9pt; line-height: 1.5; }
.swatches { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4mm; margin-top: 12mm; height: 100mm; }
.swatches div { display: flex; flex-direction: column; padding: 5mm; border-radius: 1.5mm; box-shadow: inset 0 0 0 .2mm rgb(0 0 0 / 8%); }
.swatches b { font-size: 9pt; letter-spacing: .2em; text-transform: uppercase; }
.swatches small { margin-top: 2mm; font-size: 7pt; line-height: 1.45; opacity: .85; }
.swatches span { margin-top: auto; font-size: 6.5pt; line-height: 1.7; letter-spacing: .06em; }
.combos { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4mm; margin-top: 26mm; }
.combos div { aspect-ratio: 1; display: flex; align-items: center; justify-content: center; border-radius: 1.5mm; box-shadow: inset 0 0 0 .2mm rgb(0 0 0 / 8%); }
.wordmark { font-size: 20pt; letter-spacing: .04em; text-align: center; }
.f-end .wordmark { font-size: 5cqh; }
.tint { display: block; -webkit-mask-size: contain; mask-size: contain; -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat; -webkit-mask-position: center; mask-position: center; }
.type { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm 16mm; margin-top: 10mm; }
.type h5, .cols h5 { margin: 0 0 3mm; font-size: 7pt; letter-spacing: .24em; text-transform: uppercase; font-weight: 500; }
.type .big { font-size: 26pt; line-height: 1.1; }
.type .spec { margin: 3mm 0 0; font-size: 12pt; line-height: 1.35; }
.type .meta { margin: 2mm 0 0; font-size: 7pt; letter-spacing: .1em; opacity: .7; }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16mm; margin-top: 12mm; }
dl { margin: 0; display: grid; grid-template-columns: 34mm 1fr; }
dt, dd { margin: 0; padding: 3mm 0; border-bottom: .2mm solid ${line}44; font-size: 9pt; line-height: 1.5; }
dt { font-size: 7pt; letter-spacing: .2em; text-transform: uppercase; padding-top: 3.6mm; }
.notes { font-size: 9pt; line-height: 1.6; }
</style></head><body>${pages.join('\n')}</body></html>`;
}

/** Print HTML to a PDF in a hidden window, once its fonts and pictures are in. */
async function printPdf(html: string): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), 'cutroom-guidelines-'));
  const file = path.join(dir, 'guidelines.html');
  await writeFile(file, html);
  const win = new BrowserWindow({ show: false, width: 1123, height: 794, webPreferences: { javascript: true, sandbox: true } });
  try {
    await win.loadFile(file);
    // Fonts from Google need the network: wait for them, but never long.
    await win.webContents.executeJavaScript(`Promise.race([Promise.all([document.fonts.ready, ...[...document.images].map((i) => i.decode().catch(() => {}))]), new Promise((r) => setTimeout(r, 8000))]).then(() => true)`);
    return await win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, margins: { top: 0, bottom: 0, left: 0, right: 0 } });
  } finally {
    win.destroy();
    await rm(dir, { recursive: true, force: true });
  }
}

export const guidelinesPdf = async (kit: BrandKit): Promise<Buffer> => printPdf(await guidelinesHtml(kit));

// --- Markdown -------------------------------------------------------------------------------------------

/** The guidelines as Markdown; `files` is where the kit's files sit, relative to the document. */
export function guidelinesMarkdown(kit: BrandKit, files: string): string {
  const link = (file: string): string => `${files ? `${files}/` : ''}${file}`.split('/').map(encodeURIComponent).join('/');
  const c = kit.colors;
  const rows = (pairs: [string, string][]): string => `| | |\n|---|---|\n${pairs.map(([k, v]) => `| **${k}** | ${v.replace(/\|/g, '\\|')} |`).join('\n')}`;
  const logos = (Object.entries(kit.logos) as [LogoSlot, string][]).map(([slot, file]) => `### ${LOGOS[slot].name}\n\n![${LOGOS[slot].name}](${link(file)})\n\n${LOGOS[slot].use}`);
  const font = (f: BrandFont): string =>
    `${f.family}, weight ${f.weight}${fontMatches(f) ? ` — [${f.file}](${link(f.file!)})` : ''}${f.source ? ` · free font, ${f.source.license}, [${f.source.library}](${f.source.url})` : fontMatches(f) ? '' : ' (no file in the kit)'}`;
  return `# ${kit.name} — brand guidelines

${kit.about.trim() || `How ${kit.name} looks and sounds in video.`}

${[kit.identity.website, kit.identity.handle].filter(Boolean).join(' · ')}

## 1. Logo

${logos.join('\n\n') || 'No logo in the kit yet.'}

### Usage

${logoRules(kit).map((r) => `- ${r}`).join('\n')}

## 2. Colour and type

### Palette

| Colour | Use | HEX | RGB | CMYK (approx.) |
|---|---|---|---|---|
${ROLES.map((r) => `| **${r.name}** | ${r.use} | \`${c[r.key].toUpperCase()}\` | ${channels(c[r.key]).join(', ')} | ${cmyk(c[r.key])} |`).join('\n')}

### Typography

${rows([
  ['Titles and short phrases', `${font(kit.fonts.heading)}, about ${kit.sizes.title}% of the frame height`],
  ['Captions and body text', `${font(kit.fonts.body)}, about ${kit.sizes.caption}% of the frame height`],
])}

## 3. Video

### Layout and captions

Positions are shares of the frame, so they hold in every format.

${layoutWords(kit).map((w) => `- **${w.element}:** ${w.text}.`).join('\n')}
${safeWords(kit) ? `- **Apps:** ${safeWords(kit)}\n` : ''}

### Motion

${rows(motionWords(kit))}

### Sound

${rows(soundWords(kit))}

### Voice and words

${rows(voiceWords(kit))}
${kit.notes.trim() ? `\n### Notes\n\n${kit.notes.trim()}\n` : ''}
---
Made with Cutroom · ${new Date().toISOString().slice(0, 10)}
`;
}

/** Where the kit's fonts come from and under which licence: open licences ask that this travels with the files. */
function fontNotes(kit: BrandKit): string {
  const lines = (['heading', 'body'] as const).map((role) => {
    const f = kit.fonts[role];
    if (!fontMatches(f)) return '';
    return f.source
      ? `${f.file}: ${f.source.family} ${f.source.weight}, ${f.source.license}, from ${f.source.library} — ${f.source.url}`
      : `${f.file}: ${f.family}, supplied by the brand. Check its licence before passing it on.`;
  }).filter(Boolean);
  return lines.length ? `Fonts in this package\n\n${[...new Set(lines)].join('\n')}\n\nOFL-1.1: https://openfontlicense.org — Apache-2.0: https://www.apache.org/licenses/LICENSE-2.0\n` : '';
}

// --- Design tokens --------------------------------------------------------------------------------------

export function tokensCss(kit: BrandKit): string {
  const c = kit.colors;
  return `/* ${kit.name} — brand tokens, from Cutroom */
:root {
${(Object.keys(c) as (keyof typeof c)[]).map((k) => `  --brand-${k}: ${c[k]};`).join('\n')}
  --brand-font-heading: "${kit.fonts.heading.family}";
  --brand-font-heading-weight: ${kit.fonts.heading.weight};
  --brand-font-body: "${kit.fonts.body.family}";
  --brand-font-body-weight: ${kit.fonts.body.weight};
}
`;
}

/** W3C design tokens format, readable by Figma plugins (Tokens Studio) and Style Dictionary. */
export function tokensJson(kit: BrandKit): string {
  const c = kit.colors;
  return JSON.stringify({
    color: Object.fromEntries((Object.keys(c) as (keyof typeof c)[]).map((k) => [k, { $type: 'color', $value: c[k] }])),
    font: Object.fromEntries((['heading', 'body'] as const).map((r) => [r, { family: { $type: 'fontFamily', $value: kit.fonts[r].family }, weight: { $type: 'fontWeight', $value: kit.fonts[r].weight } }])),
  }, null, 2);
}

// --- Export and import ----------------------------------------------------------------------------------

export type ExportFormat = 'pdf' | 'md' | 'zip';
export const exportName = (kit: BrandKit, format: ExportFormat): string =>
  `${kit.name.replace(/[/:\\]+/g, '-')} ${format === 'zip' ? 'brand kit.zip' : `brand guidelines.${format}`}`;

/** Write the kit to `file` as guidelines PDF, Markdown (with its files in a folder beside it) or a brand package. */
export async function exportBrand(kit: BrandKit, format: ExportFormat, file: string): Promise<void> {
  if (format === 'pdf') return writeFile(file, await guidelinesPdf(kit));
  const own = brandFiles(kit).filter((f) => existsSync(path.join(brandDir(kit.id), f)));
  if (format === 'md') {
    const folder = `${path.basename(file, path.extname(file))} files`;
    if (own.length) await mkdir(path.join(path.dirname(file), folder), { recursive: true });
    for (const f of own) await writeFile(path.join(path.dirname(file), folder, f), await readFile(path.join(brandDir(kit.id), f)));
    return writeFile(file, guidelinesMarkdown(kit, own.length ? folder : ''));
  }
  // The brand package: one folder in the zip, everything side by side.
  const root = path.basename(file, path.extname(file));
  const entries: Record<string, Uint8Array> = {
    [`${root}/brand.json`]: Buffer.from(JSON.stringify({ ...kit, id: undefined }, null, 2)),
    [`${root}/Brand guidelines.pdf`]: await guidelinesPdf(kit),
    [`${root}/Brand guidelines.md`]: Buffer.from(guidelinesMarkdown(kit, '')),
    [`${root}/tokens.css`]: Buffer.from(tokensCss(kit)),
    [`${root}/tokens.json`]: Buffer.from(tokensJson(kit)),
    ...(fontNotes(kit) ? { [`${root}/FONTS.txt`]: Buffer.from(fontNotes(kit)) } : {}),
    [`${root}/README.txt`]: Buffer.from(`${kit.name} — brand kit from Cutroom.\n\nOpen "Brand guidelines.pdf" to read it. In Cutroom, Home › Brand kits › Import takes this .zip as it is.\ntokens.css and tokens.json hold the colours and fonts for websites and design tools.\n`),
  };
  for (const f of own) entries[`${root}/${f}`] = await readFile(path.join(brandDir(kit.id), f));
  await writeFile(file, zipSync(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, [v, { level: /\.(png|jpe?g|webp|pdf|woff2?|mp3|m4a|aac)$/i.test(k) ? 0 : 6 }]]))));
}

/** Read a brand package (.zip) or a kit's brand.json (with its files beside it) into a new kit. */
export async function importBrand(file: string): Promise<BrandKit> {
  let entries: Record<string, Uint8Array>;
  if (/\.zip$/i.test(file)) entries = unzipSync(new Uint8Array(await readFile(file)));
  else if (path.basename(file).toLowerCase() === 'brand.json') entries = { 'brand.json': new Uint8Array(await readFile(file)) };
  else throw new Error('Import a brand package (.zip) exported from Cutroom, or a kit’s brand.json.');
  // The shallowest brand.json is the kit; its files sit next to it.
  const json = Object.keys(entries).filter((k) => /(^|\/)brand\.json$/.test(k) && !k.includes('__MACOSX')).sort((a, b) => a.split('/').length - b.split('/').length)[0];
  if (!json) throw new Error('There is no brand kit in this file (no brand.json).');
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(entries[json]!).toString('utf8'));
  } catch {
    throw new Error('The brand.json in this file is damaged.');
  }
  // A kit of the same name is already here (imported before, or the original): number the new one.
  const base = String((raw as { name?: unknown }).name ?? '').trim() || 'Imported brand kit';
  const taken = new Set((await listBrands()).map((k) => k.name));
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base} ${n}`;
  const kit = normalizeBrand(raw, newBrandId(name));
  kit.name = name;
  const prefix = json.slice(0, -'brand.json'.length);
  await mkdir(brandDir(kit.id), { recursive: true });
  // Only the files the kit names, under their own names: nothing from a package lands anywhere else.
  for (const f of brandFiles(kit)) {
    const safe = path.basename(f);
    const bytes = /\.zip$/i.test(file) ? entries[`${prefix}${safe}`] : await readFile(path.join(path.dirname(file), safe)).catch(() => undefined);
    if (bytes && safe === f) await writeFile(path.join(brandDir(kit.id), safe), bytes);
  }
  // A file that did not come along leaves its slot empty rather than pointing at nothing.
  const present = (f?: string): boolean => !!f && existsSync(path.join(brandDir(kit.id), f));
  for (const slot of Object.keys(kit.logos) as LogoSlot[]) if (!present(kit.logos[slot])) delete kit.logos[slot];
  for (const role of ['heading', 'body'] as const) if (!present(kit.fonts[role].file)) delete kit.fonts[role].file;
  kit.music.tracks = kit.music.tracks.filter(present);
  kit.sfx.files = kit.sfx.files.filter(present);
  if (!present(kit.look.lut)) delete kit.look.lut;
  return saveBrand(kit);
}
