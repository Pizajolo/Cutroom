// The logo studio: a chat in which Claude draws a kit's logo as SVG — redrawing one that exists in clean vectors, or
// designing one from scratch — shows every version, looks at its own work, and puts the chosen one into the kit.
// Conversation, uploads and versions live in the kit's folder (`.logo/`).
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { shell } from 'electron';
import { z } from 'zod';
import { fontMatches } from '../shared/brand';
import type { BrandKit, LogoSlot } from '../shared/brand';
import type { AgentEvent, LogoDraft } from '../shared/types';
import { run } from '../cli/run';
import { ATTACHMENTS, copyAttachments, kindOf } from './brandChat';
import { brandDir, brandFiles, readBrand, saveBrand } from './brands';
import { ChatRunner } from './chatRunner';
import { downloadFont, lookupFont } from './fonts';
import { textOutline } from './logoText';
import { proofSheet, svgToPng, traceImage } from './raster';
import { PDFPAGE_BIN } from './tools';

const studioDir = (id: string): string => path.join(brandDir(id), '.logo');
const drafts = (id: string): string => path.join(studioDir(id), 'drafts');
const work = (id: string): string => path.join(studioDir(id), 'work');
const uploads = (id: string): string => path.join(studioDir(id), 'uploads');
const runner = new ChatRunner(studioDir);
export const { load, stop } = runner;
/** A new conversation; the versions stay. */
export const reset = (id: string): Promise<void> => runner.reset(id);
export const attach = (id: string, files: string[]): Promise<string[]> => copyAttachments(uploads(id), files);

const SLOT_NAMES: Record<LogoSlot, string> = { main: 'full logo', mark: 'icon', onDark: 'logo for dark backgrounds' };

const PROMPT = `

# Cutroom · Logo studio

You are a logo designer in Cutroom, a video editor, working on one brand kit's logo. The user sees your latest version
large next to this chat, with every earlier version below it. You draw in SVG.

## How you work
- Every version goes through show_logo. It renders a proof (on white, black and the brand colour, and at 64 and 32 px):
  Read it, judge it like a designer — shapes, balance, spacing, alignment, legibility at small sizes, fidelity to the
  original when redrawing — and fix what is off with another show_logo before you reply. Two or three rounds is normal.
- Reply briefly: what you made or changed, and at most one question. The user can also ask for several options:
  show each as its own version and say which number is which.
- When the user is happy, or asks for it, put a version into the kit with use_logo (main = full logo, mark = icon,
  onDark = version for dark backgrounds). Never overwrite a slot without being asked.

## SVG rules
- One <svg> with xmlns and a tight viewBox (a margin of about 4% around the artwork), no width/height needed.
- Flat fills from the brand palette (given with each message), or one colour / white / black when asked. No gradients,
  filters, shadows or embedded pictures unless the user asks. A transparent background: no full-size background rect.
- No <text>: set words with text_outline (the kit's fonts, or any free font by name) and place the path with a
  transform. Lettering then looks the same everywhere.
- Prefer few, clean shapes: circles, arcs and smooth Béziers with round numbers, symmetric where the design is.

## Redrawing a logo that exists
- Look at it first (Read the kit's logo file; their names and paths come with each message).
- Simple geometry and lettering: rebuild it by hand from primitives and text_outline, matching proportions — better
  than any trace. If you can name the typeface, use it; else the closest free one, and say so.
- Organic or detailed artwork (ornaments, hand-drawn marks): trace_image gives you faithful vector shapes to start
  from; then clean up — drop stray specks, merge colours into the palette, tidy the viewBox.
- Compare your proof with the original side by side before replying.
- Versions for other uses: a one-colour version, white for dark backgrounds, the icon alone, a horizontal lockup.

## Designing from scratch
- Ask nothing you can decide: start from the kit (name, about, colours, fonts) and the user's words.
- Propose 2–3 clearly different directions as separate versions, each simple enough to work at 32 px. Then refine the
  one the user picks.`;

/** Make an SVG safe and well-formed, or say why not. */
function cleanSvg(raw: string): { svg: string; warnings: string[] } {
  let svg = raw.trim().replace(/^```(?:svg|xml)?\s*/i, '').replace(/```\s*$/, '').replace(/^<\?xml[^>]*>\s*/i, '').replace(/<!DOCTYPE[^>]*>\s*/i, '').trim();
  if (!/^<svg[\s>]/i.test(svg) || !/<\/svg>\s*$/i.test(svg)) throw new Error('Send one complete <svg>…</svg> document.');
  if (svg.length > 2_000_000) throw new Error('That SVG is over 2 MB: simplify it.');
  const forbidden = /<script|<foreignObject|<iframe|\son[a-z]+\s*=|javascript:|@import|<use[^>]+href\s*=\s*["'](?!#)|<image[^>]+href\s*=\s*["'](?!data:)|url\(\s*["']?(?!#|data:)/i.exec(svg);
  if (forbidden) throw new Error(`Not allowed in a logo: ${forbidden[0].trim()}`);
  if (!/^<svg[^>]*\sxmlns=/i.test(svg)) svg = svg.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  const head = /^<svg[^>]*>/i.exec(svg)![0];
  if (!/viewBox=/i.test(head)) {
    const w = /\swidth=["']?([\d.]+)/i.exec(head)?.[1];
    const h = /\sheight=["']?([\d.]+)/i.exec(head)?.[1];
    if (!w || !h) throw new Error('Give the <svg> a viewBox.');
    svg = svg.replace(/^<svg/i, `<svg viewBox="0 0 ${w} ${h}"`);
  }
  const warnings: string[] = [];
  if (/<text[\s>]/i.test(svg)) warnings.push('It has <text>: that depends on installed fonts. Use text_outline for lettering.');
  if (/<image[\s>]/i.test(svg)) warnings.push('It embeds a picture: that is not a vector logo.');
  return { svg, warnings };
}

export async function listDrafts(id: string): Promise<LogoDraft[]> {
  const names = await readdir(drafts(id)).catch(() => [] as string[]);
  const list: LogoDraft[] = [];
  for (const name of names) {
    const version = Number(/^v(\d+)\.svg$/.exec(name)?.[1]);
    if (!version) continue;
    const svg = await readFile(path.join(drafts(id), name), 'utf8');
    const meta = JSON.parse(await readFile(path.join(drafts(id), `v${version}.json`), 'utf8').catch(() => '{}')) as { note?: string; at?: string };
    list.push({ version, svg, note: meta.note ?? '', at: meta.at ?? '' });
  }
  return list.sort((a, b) => a.version - b.version);
}

async function addDraft(id: string, svg: string, note: string): Promise<LogoDraft> {
  await mkdir(drafts(id), { recursive: true });
  const version = ((await listDrafts(id)).at(-1)?.version ?? 0) + 1;
  const draft: LogoDraft = { version, svg, note, at: new Date().toISOString() };
  await writeFile(path.join(drafts(id), `v${version}.svg`), svg);
  await writeFile(path.join(drafts(id), `v${version}.json`), JSON.stringify({ note, at: draft.at }));
  return draft;
}

/** A free base name for a logo and its PNG beside it. */
function freeLogoBase(id: string, slot: LogoSlot): string {
  for (let n = 1; ; n++) {
    const base = n === 1 ? `logo-${slot}` : `logo-${slot}-${n}`;
    if (!existsSync(path.join(brandDir(id), `${base}.svg`)) && !existsSync(path.join(brandDir(id), `${base}.png`))) return base;
  }
}

/** Put a version into a slot: the SVG, and a transparent PNG beside it for tools that cannot read SVG. */
export async function useDraft(id: string, version: number, slot: LogoSlot): Promise<BrandKit> {
  const kit = await readBrand(id);
  if (!kit) throw new Error('This brand kit no longer exists.');
  const draft = (await listDrafts(id)).find((d) => d.version === version);
  if (!draft) throw new Error(`There is no version ${version}.`);
  const base = freeLogoBase(id, slot);
  await writeFile(path.join(brandDir(id), `${base}.svg`), draft.svg);
  await writeFile(path.join(brandDir(id), `${base}.png`), await svgToPng(draft.svg, 2048));
  const saved = await saveBrand({ ...kit, logos: { ...kit.logos, [slot]: `${base}.svg` } });
  for (const f of brandFiles(kit).filter((f) => !brandFiles(saved).includes(f))) await shell.trashItem(path.join(brandDir(id), f)).catch(() => {});
  return saved;
}

const IMAGE_TYPES: Record<string, string> = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

/** Tools Claude draws with. `drafted` and `changed` reach the studio and the kit's page. */
function studioTools(id: string, drafted: (draft: LogoDraft) => void, changed: (kit: BrandKit) => void) {
  const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
  const fail = (t: string) => ({ content: [{ type: 'text' as const, text: t }], isError: true });
  const current = async (): Promise<BrandKit> => {
    const kit = await readBrand(id);
    if (!kit) throw new Error('This brand kit no longer exists.');
    return kit;
  };
  /** A picture by logo slot, or by path inside the kit (attachments, PDF pages, earlier work). */
  const picture = async (image: string, page?: number): Promise<{ file: string; dataUrl: string }> => {
    const kit = await current();
    const slot = (['main', 'mark', 'onDark'] as LogoSlot[]).find((s) => s === image);
    let file = slot ? (kit.logos[slot] ? path.join(brandDir(id), kit.logos[slot]!) : '') : path.resolve(studioDir(id), image);
    if (!file) throw new Error(`The kit has no ${SLOT_NAMES[slot!]}.`);
    if (!file.startsWith(brandDir(id) + path.sep) || !existsSync(file)) throw new Error(`${image} is not a logo slot or a picture of this kit.`);
    if (kindOf(file) === 'pdf') {
      if (!page) throw new Error('For a PDF, say which page.');
      if (!existsSync(PDFPAGE_BIN)) throw new Error('PDF pages are not set up on this Mac (they need Apple’s command line tools).');
      await mkdir(work(id), { recursive: true });
      const line = (await run(PDFPAGE_BIN, [file, work(id), String(page)])).trim();
      file = line.split(' ')[1]!;
    }
    const type = IMAGE_TYPES[path.extname(file).toLowerCase()];
    if (!type) throw new Error(`${path.basename(file)} is not a picture.`);
    return { file, dataUrl: `data:${type};base64,${(await readFile(file)).toString('base64')}` };
  };

  return createSdkMcpServer({
    name: 'logo',
    version: '1.0.0',
    tools: [
      tool(
        'show_logo',
        'Show an SVG to the user as the next version, and get a proof to Read: large on white, black and the brand colour, and at 64 and 32 px.',
        { svg: z.string().describe('The complete SVG document'), note: z.string().describe('A few words on what this version is, shown under it (e.g. "Redrawn in vectors", "Option B: monogram")') },
        async ({ svg, note }) => {
          try {
            const clean = cleanSvg(svg);
            const draft = await addDraft(id, clean.svg, note);
            await mkdir(work(id), { recursive: true });
            const proof = path.join(work(id), `proof-v${draft.version}.png`);
            await writeFile(proof, await proofSheet(clean.svg, (await current()).colors.primary));
            drafted(draft);
            return text(`Shown as version ${draft.version}. Proof — Read it: ${proof}${clean.warnings.length ? `\nNote: ${clean.warnings.join(' ')}` : ''}`);
          } catch (error) {
            return fail((error as Error).message);
          }
        },
      ),
      tool(
        'trace_image',
        'Trace a picture into SVG shapes, as a faithful starting point for redrawing detailed artwork. The picture: a logo slot (main, mark, onDark) or a path of an attachment (a PDF needs a page). The background colour is left out. Shown to the user as a version.',
        {
          image: z.string(),
          page: z.number().int().min(1).optional(),
          colors: z.number().int().min(2).max(8).optional().describe('Colours including the background: 2 for a one-colour logo on a plain background (default)'),
          detail: z.enum(['clean', 'detailed']).optional().describe('clean (default): fewer, smoother shapes; detailed: follows small features'),
        },
        async ({ image, page, colors = 2, detail = 'clean' }) => {
          try {
            const { file, dataUrl } = await picture(image, page);
            const { svg, kept, dropped } = await traceImage(dataUrl, colors, detail);
            const draft = await addDraft(id, svg, `Traced from ${path.basename(file)}`);
            await mkdir(work(id), { recursive: true });
            const traced = path.join(work(id), `trace-v${draft.version}.svg`);
            await writeFile(traced, svg);
            const proof = path.join(work(id), `proof-v${draft.version}.png`);
            await writeFile(proof, await proofSheet(svg, (await current()).colors.primary));
            drafted(draft);
            return text(`Traced into ${kept} shapes (${dropped} background or stray ones left out), shown as version ${draft.version}.\nSVG (Read it to edit): ${traced}\nProof — Read it: ${proof}`);
          } catch (error) {
            return fail((error as Error).message);
          }
        },
      ),
      tool(
        'text_outline',
        'Set text in a font and get it as one SVG path (outlines, top-left at 0,0) with its width and height, to place in a logo with a transform. font: "heading" or "body" for the kit\'s fonts, or any free font family by name.',
        {
          text: z.string().min(1).max(80),
          font: z.string(),
          weight: z.number().int().min(100).max(900).optional().describe('For a family by name; default 400'),
          size: z.number().min(4).max(2000).describe('Font size in SVG units'),
          tracking: z.number().min(-0.2).max(1).optional().describe('Extra space between letters in em, e.g. 0.12'),
        },
        async ({ text: words, font, weight = 400, size, tracking = 0 }) => {
          try {
            const kit = await current();
            const role = font === 'heading' || font === 'body' ? kit.fonts[font] : undefined;
            let file: string;
            let name: string;
            if (role && fontMatches(role)) {
              file = path.join(brandDir(id), role.file!);
              name = `${role.family} ${role.weight}`;
            } else {
              const family = role?.family ?? font;
              const look = await lookupFont(family);
              if (!look.found) return fail(`${family} is not a free font and the kit has no file for it.${look.suggestions.length ? ` Free alternatives: ${look.suggestions.join(', ')}.` : ''}`);
              const got = await downloadFont(path.join(studioDir(id), 'fonts'), look.found.family, role?.weight ?? weight);
              file = path.join(studioDir(id), 'fonts', got.file);
              name = `${got.source.family} ${got.source.weight}`;
            }
            const o = textOutline(file, words, size, tracking);
            return text(`"${words}" in ${name} at ${size}: width ${o.width}, height ${o.height}, baseline at ${o.baseline}, cap height ${o.capHeight} (top-left at 0,0).\n<path d="${o.d}"/>`);
          } catch (error) {
            return fail((error as Error).message);
          }
        },
      ),
      tool(
        'use_logo',
        'Put a version into the brand kit: main (full logo), mark (icon) or onDark (for dark backgrounds). Saves the SVG and a transparent PNG beside it, and replaces what the slot had.',
        { version: z.number().int().min(1), slot: z.enum(['main', 'mark', 'onDark']) },
        async ({ version, slot }) => {
          try {
            changed(await useDraft(id, version, slot as LogoSlot));
            return text(`Version ${version} is now the kit's ${SLOT_NAMES[slot as LogoSlot]}.`);
          } catch (error) {
            return fail((error as Error).message);
          }
        },
      ),
    ],
  });
}

function describe(name: string, input: Record<string, unknown>): string {
  if (name === 'mcp__logo__show_logo') return `Drawing: ${String(input.note ?? 'a new version')}`;
  if (name === 'mcp__logo__trace_image') return `Tracing ${(['main', 'mark', 'onDark'] as string[]).includes(String(input.image)) ? `the ${SLOT_NAMES[input.image as LogoSlot]}` : path.basename(String(input.image))}`;
  if (name === 'mcp__logo__text_outline') return `Setting “${String(input.text)}” in ${String(input.font) === 'heading' || String(input.font) === 'body' ? `the ${String(input.font)} font` : String(input.font)}`;
  if (name === 'mcp__logo__use_logo') return `Putting version ${String(input.version)} into the kit as the ${SLOT_NAMES[String(input.slot) as LogoSlot] ?? 'logo'}`;
  if (name === 'Read') {
    const file = path.basename(String(input.file_path ?? ''));
    return /^proof-v(\d+)/.test(file) ? `Looking at version ${/^proof-v(\d+)/.exec(file)![1]}` : `Looking at ${file}`;
  }
  return name;
}

/** Send a message to the studio of kit `id`. */
export async function send(
  id: string, text: string, files: string[], emit: (event: AgentEvent) => void, drafted: (draft: LogoDraft) => void, changed: (kit: BrandKit) => void,
): Promise<void> {
  const kit = await readBrand(id);
  if (!kit) throw new Error('This brand kit no longer exists.');
  const attached = files.filter((name) => existsSync(path.join(uploads(id), path.basename(name))));
  const logos = (Object.entries(kit.logos) as [LogoSlot, string][]).map(([slot, file]) => `- ${SLOT_NAMES[slot]} (${slot}): ${path.join(brandDir(id), file)}`);
  const latest = (await listDrafts(id)).at(-1);
  const how = { pdf: 'PDF: Read it, or trace_image with a page', video: 'video: not usable here', image: 'picture: Read it, or trace_image' };
  const context = [
    `<kit name="${kit.name}">`,
    kit.about ? `About: ${kit.about}` : '',
    `Colours: primary ${kit.colors.primary}, secondary ${kit.colors.secondary}, accent ${kit.colors.accent}, text ${kit.colors.text}, background ${kit.colors.background}`,
    `Fonts: heading ${kit.fonts.heading.family} ${kit.fonts.heading.weight}${fontMatches(kit.fonts.heading) ? '' : ' (no file yet)'}; body ${kit.fonts.body.family} ${kit.fonts.body.weight}${fontMatches(kit.fonts.body) ? '' : ' (no file yet)'}`,
    logos.length ? `Logos in the kit:\n${logos.join('\n')}` : 'No logos in the kit yet.',
    latest ? `Latest version: ${latest.version} (${latest.note}) — ${path.join(drafts(id), `v${latest.version}.svg`)}` : 'No versions yet.',
    '</kit>',
  ].filter(Boolean).join('\n');
  const attachments = attached.length
    ? `\n\n<attachments>\n${attached.map((n) => `- ${path.join(uploads(id), n)} (${how[kindOf(n) ?? 'image']})`).join('\n')}\n</attachments>`
    : '';
  await runner.send(id, {
    text,
    files: attached,
    prompt: `${text}${attachments}\n\n${context}`,
    systemPrompt: PROMPT,
    mcpServers: { logo: studioTools(id, drafted, changed) },
    allowedTools: ['mcp__logo'],
    disallowedTools: ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'AskUserQuestion', 'Task', 'TodoWrite', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Bash'],
    // Reading only this kit's files: its logos, attachments, proofs and versions.
    canUseTool: async (name, input) =>
      name === 'Read' && path.resolve(studioDir(id), String(input.file_path ?? '')).startsWith(brandDir(id) + path.sep)
        ? { behavior: 'allow', updatedInput: input }
        : { behavior: 'deny', message: 'In the logo studio you can read this kit’s files and draw with the logo tools.' },
    describe,
    emit,
  });
}

/** What can be attached in the studio: guidelines, sketches, pictures of logos. */
export const STUDIO_ATTACHMENTS = [...ATTACHMENTS.pdf, ...ATTACHMENTS.image];
