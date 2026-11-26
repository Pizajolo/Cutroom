// Brand kits in `~/.cutroom/library/brands/<id>/`: brand.json and the files it names (logos, fonts, music, …).
// Each chat (cut) picks one; the agent gets it as part of its instructions and is told when it changes.
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CUTOUT_BIN } from '../cli/cutout';
import { LIBRARY } from '../cli/project';
import { run } from '../cli/run';
import { downloadFont } from './fonts';
import { ASPECTS, emptyBrand, fontMatches, layoutWords, normalizeBrand, safeWords } from '../shared/brand';
import type { BrandKit, BrandSlot, LogoSlot } from '../shared/brand';

export const BRANDS = path.join(LIBRARY, 'brands');
export const brandDir = (id: string): string => {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error('Not a brand kit.');
  return path.join(BRANDS, id);
};
const kitFile = (id: string): string => path.join(brandDir(id), 'brand.json');

export async function readBrand(id: string): Promise<BrandKit | null> {
  const text = await readFile(kitFile(id), 'utf8').catch(() => '');
  if (!text) return null;
  try {
    return normalizeBrand(JSON.parse(text), id);
  } catch {
    return null;
  }
}

export async function listBrands(): Promise<BrandKit[]> {
  await mkdir(BRANDS, { recursive: true });
  const kits: BrandKit[] = [];
  for (const dir of await readdir(BRANDS)) {
    const kit = /^[a-z0-9][a-z0-9-]*$/.test(dir) ? await readBrand(dir) : null;
    if (kit) kits.push(kit);
  }
  return kits.sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveBrand(kit: BrandKit): Promise<BrandKit> {
  const next = { ...normalizeBrand(kit, kit.id), updatedAt: new Date().toISOString() };
  await mkdir(brandDir(kit.id), { recursive: true });
  await writeFile(kitFile(kit.id), JSON.stringify(next, null, 2));
  return next;
}

/** A folder name for a new kit: readable, never one in use. */
export function newBrandId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'brand';
  for (let n = 1; ; n++) {
    const id = n === 1 ? slug : `${slug}-${n}`;
    if (!existsSync(path.join(BRANDS, id))) return id;
  }
}

export const createBrand = (name: string): Promise<BrandKit> => saveBrand(emptyBrand(newBrandId(name), name.trim() || 'Brand kit'));

/** Copy a file into the kit's folder under its own name (numbered if taken) and return that name. */
async function take(id: string, source: string): Promise<string> {
  const dir = brandDir(id);
  const ext = path.extname(source);
  const base = path.basename(source, ext).replace(/[^\w .-]+/g, '-').replace(/^\.+/, '') || 'file';
  let name = `${base}${ext.toLowerCase()}`;
  for (let n = 2; existsSync(path.join(dir, name)); n++) name = `${base}-${n}${ext.toLowerCase()}`;
  await copyFile(source, path.join(dir, name));
  return name;
}

/** Put files into a slot of the kit (replacing what a single-file slot had) and save it. */
export async function addBrandFiles(kit: BrandKit, slot: BrandSlot, files: string[]): Promise<BrandKit> {
  if (!files.length) return kit;
  await mkdir(brandDir(kit.id), { recursive: true });
  const names: string[] = [];
  for (const file of slot === 'music' || slot === 'sfx' ? files : files.slice(0, 1)) names.push(await take(kit.id, file));
  const next: BrandKit = structuredClone(kit);
  if (slot.startsWith('logo:')) next.logos[slot.slice(5) as LogoSlot] = names[0];
  else if (slot === 'font:heading' || slot === 'font:body') {
    const font = next.fonts[slot === 'font:heading' ? 'heading' : 'body'];
    font.file = names[0];
    delete font.source; // the user's own file
    // The file's name is the best guess at its family until the user types the real one.
    if (!font.family.trim() || font.family === 'Inter') font.family = path.basename(names[0]!, path.extname(names[0]!)).replace(/[-_](regular|bold|black|medium|semibold|light|italic|variable).*$/i, '').replace(/[-_]+/g, ' ');
  } else if (slot === 'music') next.music.tracks = [...next.music.tracks, ...names];
  else if (slot === 'sfx') next.sfx.files = [...next.sfx.files, ...names];
  else next.look.lut = names[0];
  return saveBrand(next);
}

/** Take a file out of a slot. The file itself stays in the folder (the caller may trash it once nothing uses it). */
export function withoutFile(kit: BrandKit, slot: BrandSlot, file?: string): BrandKit {
  const next: BrandKit = structuredClone(kit);
  if (slot.startsWith('logo:')) delete next.logos[slot.slice(5) as LogoSlot];
  else if (slot === 'font:heading' || slot === 'font:body') {
    const font = next.fonts[slot === 'font:heading' ? 'heading' : 'body'];
    delete font.file;
    delete font.source;
  }
  else if (slot === 'music') next.music.tracks = next.music.tracks.filter((f) => f !== file);
  else if (slot === 'sfx') next.sfx.files = next.sfx.files.filter((f) => f !== file);
  else delete next.look.lut;
  return next;
}

/** Every file a kit refers to. */
export const brandFiles = (kit: BrandKit): string[] =>
  [...Object.values(kit.logos), ...Object.values(kit.logos).filter((f) => /\.svg$/i.test(f)).map((f) => f.replace(/\.svg$/i, '.png')), kit.fonts.heading.file, kit.fonts.body.file, ...kit.music.tracks, ...kit.sfx.files, kit.look.lut].filter((f): f is string => !!f);

/** Download the free font a role names (family and weight) into the kit, and save it. */
export async function fetchFont(kit: BrandKit, role: 'heading' | 'body'): Promise<BrandKit> {
  const font = kit.fonts[role];
  const got = await downloadFont(brandDir(kit.id), font.family, font.weight);
  const next: BrandKit = structuredClone(kit);
  next.fonts[role] = { family: got.source.family, weight: got.source.weight, file: got.file, source: got.source };
  return saveBrand(next);
}

// --- Logos: downloaded by Claude, edited in the app -------------------------------------------------

const LOGO_TYPES: Record<string, string> = { 'image/svg+xml': '.svg', 'image/png': '.png', 'image/webp': '.webp', 'image/jpeg': '.jpg' };

/** A free file name in the kit's folder: `<base><ext>`, else `<base>-2<ext>`, … */
export function freeName(id: string, base: string, ext: string): string {
  let name = `${base}${ext}`;
  for (let n = 2; existsSync(path.join(brandDir(id), name)); n++) name = `${base}-${n}${ext}`;
  return name;
}

/** Download a logo into the kit's folder; undefined when it is not an image. */
export async function downloadLogo(id: string, url: string, slot: LogoSlot): Promise<string | undefined> {
  if (!/^https?:\/\//.test(url)) return undefined;
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
  if (!response?.ok) return undefined;
  const type = (response.headers.get('content-type') ?? '').split(';')[0]!.trim();
  const fromName = path.extname(new URL(url).pathname).toLowerCase();
  const ext = LOGO_TYPES[type] ?? (Object.values(LOGO_TYPES).includes(fromName) ? fromName : '');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!ext || bytes.length < 100 || bytes.length > 15_000_000) return undefined;
  const name = freeName(id, `logo-${slot}`, ext);
  await writeFile(path.join(brandDir(id), name), bytes);
  return name;
}

/** A logo edited in the app (always a PNG) goes into a slot under a new name, so the old file can go to the Trash. */
export async function saveLogo(kit: BrandKit, slot: LogoSlot, png: Uint8Array): Promise<BrandKit> {
  if (png.length < 8 || Buffer.from(png.subarray(0, 4)).toString('hex') !== '89504e47') throw new Error('Not a PNG.');
  await mkdir(brandDir(kit.id), { recursive: true });
  const name = freeName(kit.id, `logo-${slot}-edit`, '.png');
  await writeFile(path.join(brandDir(kit.id), name), png);
  return saveBrand({ ...kit, logos: { ...kit.logos, [slot]: name } });
}

const MIME: Record<string, string> = { ...Object.fromEntries(Object.entries(LOGO_TYPES).map(([type, ext]) => [ext, type])), '.jpeg': 'image/jpeg' };

/** One of the kit's images as a data: URL, so the logo editor can draw it into a canvas without tainting it. */
export async function readImage(id: string, file: string): Promise<string> {
  const full = path.join(brandDir(id), path.basename(file));
  const type = MIME[path.extname(full).toLowerCase()];
  if (!type) throw new Error('Not an image.');
  return `data:${type};base64,${(await readFile(full)).toString('base64')}`;
}

/** The subject of an image lifted off its background with Apple Vision (the cutout helper), as a PNG data: URL. */
export async function liftImage(dataUrl: string): Promise<string> {
  if (!existsSync(CUTOUT_BIN)) throw new Error('Lifting needs the cutout helper, which needs Apple’s command line tools: run “xcode-select --install” and restart Cutroom.');
  const match = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error('Not an image.');
  const dir = await mkdtemp(path.join(tmpdir(), 'cutroom-logo-'));
  try {
    const input = path.join(dir, `in.${match[1] === 'jpeg' ? 'jpg' : match[1]}`);
    await writeFile(input, Buffer.from(match[2]!, 'base64'));
    // The helper says why it could not on stdout ("No subject stands out…"): a flat logo usually has no "subject".
    await run(CUTOUT_BIN, [input, path.join(dir, 'out.png')]).catch(() => {
      throw new Error('Apple Vision found nothing to lift off here — it works on photos. For a logo on a plain background, use “Remove the background colour”.');
    });
    return `data:image/png;base64,${(await readFile(path.join(dir, 'out.png'))).toString('base64')}`;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// --- What the agent is told -----------------------------------------------------------------------


/** The kit as instructions for the agent, with absolute paths to its files. */
export function describeBrand(kit: BrandKit): string {
  const dir = brandDir(kit.id);
  const file = (name?: string): string => (name ? path.join(dir, name) : '');
  const assets = `assets/brand/${kit.id}`;
  const font = (role: string, f: BrandKit['fonts']['heading']): string =>
    `- ${role}: "${f.family}", weight ${f.weight}` +
    (fontMatches(f) ? ` — file ${file(f.file)}` : ' — no file: a font installed on this Mac, or a Google Font (load it from fonts.googleapis.com in HyperFrames graphics; for FFmpeg text, download the .ttf into assets/brand first)');
  // A logo drawn in the logo studio is an SVG with a transparent PNG beside it.
  const png = (name: string): string => {
    const beside = name.replace(/\.svg$/i, '.png');
    return /\.svg$/i.test(name) && existsSync(path.join(dir, beside)) ? ` (as PNG: ${file(beside)})` : '';
  };
  const logos = (Object.entries(kit.logos) as [LogoSlot, string][]).map(([slot, name]) =>
    `${{ main: 'full logo', mark: 'icon only', onDark: 'for dark backgrounds' }[slot]}: ${file(name)}${png(name)}`);
  const size = kit.format.aspect ? ASPECTS[kit.format.aspect] : undefined;
  const lines = [
    `# Brand kit: "${kit.name}"`,
    '',
    'This version of the video uses the user\'s brand kit. Follow it in everything you design — titles, captions, graphics,',
    'lower thirds, end card, colour, music and sound — unless a message asks for something else. A style or move the user',
    'picks decides how the video is cut and animated; the brand kit decides its fonts, colours, logo and sound.',
    `The kit's files are in ${dir}/. Copy the ones you use into ${assets}/ (cp -n) and use them from there, and record each`,
    `once: cutroom ledger ${assets}/<file> --source "Brand kit ${kit.name}" --license "The user's own brand asset".`,
    'Never recolour, stretch, crop or redraw a logo. For an .svg logo use the PNG beside it on the timeline, or the SVG',
    'itself inside a HyperFrames graphic; an .svg without one needs rendering to a transparent .png first.',
    '',
    kit.identity.handle || kit.identity.website ? `- Brand: ${[kit.identity.handle, kit.identity.website].filter(Boolean).join(' · ')}` : '',
    kit.about.trim() ? `- About the brand: ${kit.about.trim()}` : '',
    logos.length ? `- Logos: ${logos.join('; ')}` : '- Logos: none in the kit. If the video needs one, look in assets/, else ask for it.',
    kit.endCard.on ? `- End card: yes (the logo-end-card move)${kit.endCard.line ? `, with the line "${kit.endCard.line}"` : ''}.` : '- End card: none.',
    `- Colours: primary ${kit.colors.primary}, secondary ${kit.colors.secondary}, accent ${kit.colors.accent} (highlights), text ${kit.colors.text}, background ${kit.colors.background}. Use no other colours in graphics.`,
    font('Headings and titles', kit.fonts.heading),
    font('Captions and body text', kit.fonts.body),
    '  Font files: copy them into the graphic\'s own folder and load them with @font-face; for FFmpeg drawtext use fontfile=.',
    '- Layout (fractions of the frame, for every format; place graphics and captions exactly so):',
    ...layoutWords(kit).map((w) => `  ${w.element}: ${w.text}.`),
    safeWords(kit) ? `  Apps: ${safeWords(kit)} This applies to vertical video.` : '',
    '  The logo watermark is one overlay labelled "brand watermark". A title goes with the subtitle under it when there is one.',
    kit.music.tracks.length
      ? `- Music: use one of the kit's tracks (${kit.music.tracks.map(file).join(', ')}), whichever fits${kit.music.mood ? ` — the brand's mood is "${kit.music.mood}"` : ''}.`
      : kit.music.mood ? `- Music: mood "${kit.music.mood}". Use music from assets/, or generate it if that is available; otherwise ask.` : '- Music: no preference.',
    `  Under speech, music sits at volume ${kit.music.level}; it may be louder where nobody talks.`,
    kit.sfx.amount === 'none'
      ? '- Sound effects: none.'
      : `- Sound effects: ${kit.sfx.amount === 'lots' ? 'lots — on cuts, titles and pop-ups' : 'subtle — only on a few key moments'}${kit.sfx.files.length ? `; use the kit's sounds first: ${kit.sfx.files.map(file).join(', ')}` : ''}.`,
    kit.look.lut ? `- Look: the LUT ${file(kit.look.lut)} on the whole video (copy it into ${assets}/ and set it as the timeline's grade.lut), after fixing exposure per clip.` : '',
    `- Transitions: ${{ cuts: 'hard cuts', crossfades: 'short crossfades', whips: 'whip pans and fast pushes', mixed: 'mostly cuts, an occasional crossfade or whip' }[kit.look.transitions]}. Energy: ${kit.look.energy}.`,
    kit.voice ? `- Voice-over: the ElevenLabs voice "${kit.voice.name}" (voice_id ${kit.voice.id}).` : '',
    kit.copy.language ? `- Language of all text on screen and voice-over: ${kit.copy.language}.` : '',
    kit.copy.tone ? `- Tone of the wording: ${kit.copy.tone}.` : '',
    kit.copy.avoid ? `- Never write: ${kit.copy.avoid}.` : '',
    `- Emoji in text on screen: ${kit.copy.emoji ? 'fine, sparingly' : 'none'}.`,
    size ? `- Format: ${kit.format.aspect} (${size.width}×${size.height}) unless the user asks for another.` : '',
    kit.format.length ? `- Length: about ${kit.format.length} s unless the user asks otherwise.` : '',
    kit.notes.trim() ? `- Notes from the user:\n${kit.notes.trim().replace(/^/gm, '  ')}` : '',
  ];
  return `\n\n${lines.filter((line) => line !== '').join('\n')}\n`;
}

/** What a chat's agent last saw of its kit, so it can be told about a change. */
export interface BrandSeen {
  id: string;
  name: string;
  updatedAt: string;
}

/** The message note for a kit that changed since the agent's last message in this chat, if it did. */
export function brandChange(before: BrandSeen | null, now: BrandKit | null): string {
  if ((before?.id ?? '') === (now?.id ?? '') && (!now || before?.updatedAt === now.updatedAt)) return '';
  const body = !now
    ? `The user took the brand kit "${before!.name}" off this version. Keep the current look unless they ask for changes.`
    : before?.id === now.id
      ? `The user changed the brand kit "${now.name}" since your last message (see "Brand kit" in your instructions). If there is an edit, check it against the kit and update what no longer matches.`
      : `The user switched this version to the brand kit "${now.name}"${before ? ` (it used "${before.name}")` : ''}; see "Brand kit" in your instructions. ` +
        'If there is already an edit, restyle it to the kit: fonts, colours, logo and watermark, captions, end card, music and sound effects, re-rendering the graphics. ' +
        'Keep the cut, its timing and the content unless the user says otherwise, and tell them in a sentence or two what changed.';
  return `<brand>\n${body}\n</brand>\n\n`;
}
