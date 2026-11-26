// The Claude chat on a brand kit's page: Claude reads the brand's website (or listens to a description) and fills in
// the kit through its own tools, so the form and the preview change while it works. One conversation per kit, kept in
// the kit's folder (`.chat/`). It can read web pages and change this kit — nothing else.
import { constants, existsSync } from 'node:fs';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { shell } from 'electron';
import { z } from 'zod';
import { layoutProblems, normalizeBrand } from '../shared/brand';
import type { BrandKit, LogoSlot } from '../shared/brand';
import type { AgentEvent, FontLookup } from '../shared/types';
import { run } from '../cli/run';
import { WHISPER_MODEL } from '../cli/transcribe';
import { brandDir, brandFiles, downloadLogo, freeName, readBrand, saveBrand } from './brands';
import { downloadFont, lookupFont } from './fonts';
import { ChatRunner } from './chatRunner';
import { PDFPAGE_BIN } from './tools';

const PROMPT = `

# Cutroom · Brand kit

You help the user build a brand kit in Cutroom, a video editor. Videos made with a kit use its logo, colours, fonts,
caption style, music and sound. The user sees the kit's form and a live preview next to this chat: every change you make
with update_kit or download_logo shows there at once. Keep replies short — what you set and why, at most one question.

- The kit as it is now arrives with each message in <kit>. Change it only with update_kit (a partial kit, merged in) and
  download_logo. Leave fields the user set alone unless they ask, or the brand clearly says otherwise.
- With a website: open the home page (and an about page if it helps) for the name, voice and look. To read colours,
  fonts and logos you may also fetch the raw HTML and stylesheets with a plain \`curl -sL <url>\` (no other commands):
  theme-color, CSS custom properties, the most used colours, font-family and Google Fonts links, the logo in the header
  (an <img> or .svg/.png file), apple-touch-icon or a large favicon for the icon.
- Without a website: design a fitting kit from what the user says.
- "about" is one or two sentences on who the brand is, for whom and how it feels; it opens the brand guidelines.
- Colours are #rrggbb. "text" must be readable on "background"; "accent" is for highlights (the word being said).
- Fonts: the brand's own typefaces with their weights. Setting a family in update_kit downloads it into the kit when it
  is a free font (Google Fonts or other open-licensed families); the result says so. A paid font cannot be downloaded:
  keep its name if the user will upload the file (say so), or choose the closest free typeface and tell the user which
  one you picked and why. Check a name first with find_font when unsure of its exact spelling.
- layout says where everything sits, as fractions of the frame (0–1), for every format:
  title, subtitle, caption: { x, y (the box's top-left), w (its width), size (% of the frame height: titles 5–9,
  subtitles 2.5–4, captions 3.5–5.5), align left|center|right, color primary|secondary|accent|text|background|white|black,
  case as-written|upper|lower (captions use captions.case), italic, on }; logo (the watermark): { x, y, w };
  handle (the @handle tag): { x, y, size, on }; platforms: which of tiktok, reels, shorts to keep clear of.
  Their buttons and text cover the top 11%, the right 15% and the bottom 22% of a vertical video: keep titles,
  captions and the logo inside x 0.05–0.85, y 0.11–0.78. From a reference video, measure where things sit in the frames.
  The user can drag everything in the layout studio; change positions only when asked or when you learn them.
- Logos: download_logo with a real image URL you found (.svg, .png, .webp, .jpg). Never invent URLs. You can Read the
  kit's own image files (in the folder above your working folder) to check a logo looks right. You cannot draw or
  edit images: for a white version, a removed background, a crop or another colour, tell the user to press the pencil on
  the logo — the logo editor does that.
- Other files (paid fonts, music, sound effects, LUTs) are uploaded by the user in the form; you cannot add them.

## Attachments: brand guidelines and reference videos
The user can attach a brand guideline PDF, a reference video (or paste a link: download_video) or images; they arrive
in <attachments>. Take everything the kit can hold from them, then say in a few lines what you found and what is
missing (e.g. "no font files: upload them in Typography").
- PDF: Read it (for long ones, the pages that matter: pages "1-5"). Guidelines name colours (use the hex; convert RGB,
  CMYK or Pantone to the closest hex), typefaces and weights, logo versions and how to use them, tone of voice, words to
  avoid, languages, sometimes caption, music and video rules. Logos: pdf_pages renders a page as an image (Read it),
  then save_logo cuts the logo out with a crop. Prefer the page that shows the logo alone, on white or on nothing.
- Video: video_frames first (it also measures the cuts: their rhythm says transitions and energy), then Read the
  frames. Read colours, typefaces (the closest Google Font to what you see), caption style (case, position, words at a
  time, highlight colour, outline or shadow), title sizes as % of the frame height, the watermark and the end card.
  transcribe_video when people talk: language, tone, catchphrases. For a logo, video_still at a moment where it is
  large and clean (often the end card), then save_logo with a tight crop.
- save_logo takes the crop as fractions of the image (x, y = top left; w, h = size). Leave a little margin. If the
  logo sits on a background, tell the user to press the pencil on it and use "Remove the background colour".
- Never take music, footage or voice out of a video: describe the music's mood instead, and let the user upload
  tracks they may use.
- Field values: captions.mode speech | always | off; captions.case as-spoken | upper | lower; captions.position top |
  middle | lower-third | bottom; sfx.amount none | subtle | lots; look.transitions cuts | crossfades | whips | mixed;
  look.energy calm | balanced | punchy; format.aspect "" | 9:16 | 16:9 | 1:1 | 4:5; watermark.corner top-left | top-right
  | bottom-left | bottom-right; watermark.logo main | mark | onDark.`;

const chatDir = (id: string): string => path.join(brandDir(id), '.chat');
const runner = new ChatRunner(chatDir);
export const { load, stop } = runner;
export const reset = (id: string): Promise<void> => runner.reset(id);

// --- Attachments: brand guidelines, reference videos, pictures ------------------------------------------

/** What the user can attach, by kind. */
export const ATTACHMENTS = { pdf: ['pdf'], video: ['mp4', 'mov', 'm4v', 'webm', 'mkv'], image: ['png', 'jpg', 'jpeg', 'webp', 'svg'] } as const;
export const kindOf = (file: string): keyof typeof ATTACHMENTS | undefined =>
  (Object.keys(ATTACHMENTS) as (keyof typeof ATTACHMENTS)[]).find((k) => (ATTACHMENTS[k] as readonly string[]).includes(path.extname(file).slice(1).toLowerCase()));
const uploads = (id: string): string => path.join(chatDir(id), 'uploads');
/** Frames, stills, pages and audio Claude makes from the attachments. */
const workDir = (id: string): string => path.join(chatDir(id), 'work');

/** Copy files into a chat's uploads folder (clones on APFS, so even long videos cost nothing) and return their names. */
export async function copyAttachments(folder: string, files: string[]): Promise<string[]> {
  await mkdir(folder, { recursive: true });
  const names: string[] = [];
  for (const file of files) {
    if (!kindOf(file)) throw new Error(`${path.basename(file)}: attach a PDF, a video or a picture.`);
    const ext = path.extname(file).toLowerCase();
    const base = path.basename(file, path.extname(file)).replace(/[^\w .-]+/g, '-').replace(/^\.+/, '') || 'file';
    let name = `${base}${ext}`;
    for (let n = 2; existsSync(path.join(folder, name)); n++) name = `${base}-${n}${ext}`;
    await copyFile(file, path.join(folder, name), constants.COPYFILE_FICLONE);
    names.push(name);
  }
  return names;
}
export const attach = (id: string, files: string[]): Promise<string[]> => copyAttachments(uploads(id), files);

/** The note that tells Claude what came with a message. */
function describeAttachments(id: string, names: string[]): string {
  if (!names.length) return '';
  const how = { pdf: 'brand guideline PDF: Read it', video: 'video: video_frames, then Read the frames', image: 'picture: Read it' };
  const lines = names.map((name) => `- ${path.join(uploads(id), name)} (${how[kindOf(name) ?? 'image']})`);
  return `\n\n<attachments note="Take everything the brand kit can hold from these.">\n${lines.join('\n')}\n</attachments>`;
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const deepMerge = (base: unknown, patch: unknown): unknown => {
  if (!isObject(base) || !isObject(patch)) return patch === undefined ? base : patch;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) out[key] = deepMerge(base[key], value);
  return out;
};
/** What a patch touches, for the step shown in the chat: "colours, fonts". */
const LABELS: Record<string, string> = {
  name: 'name', identity: 'handle and website', about: 'description', watermark: 'watermark', endCard: 'end card', colors: 'colours', fonts: 'fonts', sizes: 'text sizes',
  captions: 'captions', layout: 'layout', music: 'music', sfx: 'sound effects', look: 'transitions and energy', copy: 'tone and words', format: 'format', notes: 'notes',
};

/** The tools Claude changes this kit with. `changed` reaches the editor, which shows the new state at once. */
function kitTools(id: string, changed: (kit: BrandKit) => void) {
  const fail = (t: string) => ({ content: [{ type: 'text' as const, text: t }], isError: true });
  /** An attachment (or a picture made from one) by path or name; only files of this kit's chat. */
  const own = (file: string, kinds: (keyof typeof ATTACHMENTS)[]): string => {
    const full = path.isAbsolute(file) ? path.resolve(file) : path.join(uploads(id), path.basename(file));
    if (!full.startsWith(chatDir(id) + path.sep) || !existsSync(full)) throw new Error(`${file} is not one of the attachments.`);
    if (!kinds.includes(kindOf(full)!)) throw new Error(`${path.basename(full)} is not a ${kinds.join(' or ')}.`);
    return full;
  };
  const probe = async (file: string) => {
    const info = JSON.parse(await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height,avg_frame_rate', '-of', 'json', file])) as {
      format?: { duration?: string };
      streams?: { codec_type: string; width?: number; height?: number; avg_frame_rate?: string }[];
    };
    const video = info.streams?.find((st) => st.codec_type === 'video');
    const [num, den] = (video?.avg_frame_rate ?? '0/1').split('/').map(Number);
    return { duration: Number(info.format?.duration) || 0, width: video?.width ?? 0, height: video?.height ?? 0, fps: den ? num! / den : 0, audio: !!info.streams?.some((st) => st.codec_type === 'audio') };
  };
  const current = async (): Promise<BrandKit> => {
    const kit = await readBrand(id);
    if (!kit) throw new Error('This brand kit no longer exists.');
    return kit;
  };
  const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
  return createSdkMcpServer({
    name: 'brand',
    version: '1.0.0',
    tools: [
      tool(
        'update_kit',
        'Change the brand kit: a partial kit as JSON, merged into the current one (nested objects are merged, arrays and values replaced). The user sees the result at once.',
        { patch: z.record(z.string(), z.unknown()).describe('e.g. {"colors":{"accent":"#ffd166"},"fonts":{"heading":{"family":"Sora","weight":700}}}') },
        async ({ patch }) => {
          const kit = await current();
          // Files are the user's: Claude cannot point the kit at files, only change values.
          const { id: _id, updatedAt: _at, logos: _logos, voice: _voice, ...rest } = patch;
          const fixes: string[] = [];
          const merged = normalizeBrand(deepMerge(kit, rest), id, fixes, rest);
          merged.logos = kit.logos;
          merged.voice = kit.voice;
          merged.music.tracks = kit.music.tracks;
          merged.sfx.files = kit.sfx.files;
          merged.look.lut = kit.look.lut;
          // Fonts: a role keeps its file while it names the same family and weight. A new one is downloaded when it
          // is free; otherwise the slot waits for the user's upload.
          const notes: string[] = [];
          const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();
          for (const role of ['heading', 'body'] as const) {
            const before = kit.fonts[role];
            const now = merged.fonts[role];
            if (same(before.family, now.family) && before.weight === now.weight) {
              now.file = before.file;
              now.source = before.source;
              continue;
            }
            delete now.file;
            delete now.source;
            try {
              const got = await downloadFont(brandDir(id), now.family, now.weight);
              merged.fonts[role] = { family: got.source.family, weight: got.source.weight, file: got.file, source: got.source };
              notes.push(`${role}: downloaded ${got.source.family} ${got.source.weight} (${got.source.license}, ${got.source.library}).`);
            } catch (error) {
              const look: FontLookup = await lookupFont(now.family).catch(() => ({ suggestions: [] }));
              notes.push(look.found || /online|status|\d{3} from/i.test((error as Error).message)
                ? `${role}: ${now.family} could not be downloaded (${(error as Error).message}).`
                : `${role}: ${now.family} is not a free font, so it has no file — the user must upload it, or choose a free one${look.suggestions.length ? ` (similar names: ${look.suggestions.join(', ')})` : ''}.`);
            }
          }
          const saved = await saveBrand(merged);
          for (const role of ['heading', 'body'] as const) {
            const old = kit.fonts[role].file;
            if (old && !brandFiles(saved).includes(old)) await shell.trashItem(path.join(brandDir(id), old)).catch(() => {});
          }
          changed(saved);
          // Positions changed: check them like the layout studio does, so a logo never lands under TikTok's tabs.
          const moved = ['layout', 'sizes', 'captions', 'watermark'].some((k) => k in rest);
          const problems = moved ? layoutProblems(saved) : [];
          return text(`Saved.${fixes.length ? `\nCorrected (use these values): ${fixes.join(' ')}` : ''}${notes.length ? `\nFonts: ${notes.join(' ')}` : ''}${problems.length ? `\nLayout check (estimated): ${problems.join(' ')} Fix this with another update_kit unless the user asked for exactly this.` : ''}\nThe kit is now:\n${JSON.stringify({ ...saved, id: undefined, updatedAt: undefined }, null, 1)}`);
        },
      ),
      tool(
        'find_font',
        'Check whether a font family is free to download (Google Fonts or another open-licensed library), with its weights and licence, or get the closest free names when it is not.',
        { family: z.string() },
        async ({ family }) => {
          try {
            const look = await lookupFont(family);
            return text(look.found
              ? `${look.found.family} is free (${look.found.license}, ${look.found.library}, ${look.found.category}); weights ${look.found.weights.join(', ')}.`
              : `${family} is not a free font.${look.suggestions.length ? ` Similar free names: ${look.suggestions.join(', ')}.` : ''}`);
          } catch (error) {
            return fail((error as Error).message);
          }
        },
      ),
      tool(
        'download_logo',
        'Download a logo image from the web into one of the kit\'s logo slots: main (the full logo), mark (the icon alone) or onDark (a version for dark backgrounds). Replaces what the slot had.',
        { url: z.string().url(), slot: z.enum(['main', 'mark', 'onDark']) },
        async ({ url, slot }) => {
          const kit = await current();
          const name = await downloadLogo(id, url, slot as LogoSlot).catch(() => undefined);
          if (!name) return { ...text(`${url} is not an image that could be downloaded (it must be .svg, .png, .webp or .jpg).`), isError: true };
          const before = kit.logos[slot as LogoSlot];
          const saved = await saveBrand({ ...kit, logos: { ...kit.logos, [slot]: name } });
          // The replaced file goes unless another slot still uses it.
          if (before && !brandFiles(saved).includes(before)) await shell.trashItem(path.join(brandDir(id), before)).catch(() => {});
          changed(saved);
          return text(`Saved as the ${slot} logo (${name}).`);
        },
      ),
      tool(
        'video_frames',
        'Look at an attached video: its size, length and sound, how often it cuts (cuts per minute and the average shot), and evenly spaced frames saved as pictures to Read.',
        { file: z.string(), count: z.number().int().min(1).max(24).optional().describe('How many frames, default 12'), from: z.number().min(0).optional(), to: z.number().min(0).optional() },
        async ({ file, count = 12, from, to }) => {
          try {
            const video = own(file, ['video']);
            const info = await probe(video);
            const start = Math.min(from ?? 0, info.duration);
            const end = Math.max(start, Math.min(to ?? info.duration, info.duration));
            await mkdir(workDir(id), { recursive: true });
            const base = path.basename(video, path.extname(video));
            const frames: string[] = [];
            for (let i = 0; i < count; i++) {
              const at = start + ((i + 0.5) * (end - start)) / count;
              const out = path.join(workDir(id), `${base}-${at.toFixed(1)}s.jpg`);
              await run('ffmpeg', ['-v', 'error', '-y', '-ss', at.toFixed(2), '-i', video, '-frames:v', '1', '-vf', 'scale=720:-2', '-q:v', '3', out]);
              frames.push(`- ${at.toFixed(1)} s: ${out}`);
            }
            // Hard cuts in the first three minutes: their rhythm says transitions and energy.
            const span = Math.min(info.duration, 180);
            const cuts = (await run('ffmpeg', ['-v', 'error', '-t', String(span), '-i', video, '-an', '-vf', "scale=240:-2,select='gt(scene,0.32)',metadata=print:file=-", '-f', 'null', '-']).catch(() => ''))
              .split('\n').filter((line) => line.includes('pts_time')).length;
            const perMinute = span ? (cuts / span) * 60 : 0;
            return text(
              `${path.basename(video)}: ${info.width}×${info.height}, ${info.duration.toFixed(1)} s, ${info.fps.toFixed(0)} fps, ${info.audio ? 'with sound' : 'no sound'}.\n` +
              `Cuts: ${cuts} in the first ${span.toFixed(0)} s (${perMinute.toFixed(0)} per minute, average shot ${(span / (cuts + 1)).toFixed(1)} s). Crossfades and slow fades are not counted.\n` +
              `Frames — Read them:\n${frames.join('\n')}`,
            );
          } catch (error) {
            return fail((error as Error).message);
          }
        },
      ),
      tool(
        'video_still',
        'One frame of an attached video at full size, saved as a picture: to Read closely or to cut a logo out of with save_logo.',
        { file: z.string(), time: z.number().min(0).describe('Seconds') },
        async ({ file, time }) => {
          try {
            const video = own(file, ['video']);
            await mkdir(workDir(id), { recursive: true });
            const out = path.join(workDir(id), `${path.basename(video, path.extname(video))}-still-${time.toFixed(2)}s.png`);
            await run('ffmpeg', ['-v', 'error', '-y', '-ss', time.toFixed(3), '-i', video, '-frames:v', '1', out]);
            return text(`Saved: ${out}`);
          } catch (error) {
            return fail((error as Error).message);
          }
        },
      ),
      tool(
        'transcribe_video',
        'What is said in an attached video (the first ten minutes), with Whisper on this Mac: for the language, tone and phrases of the brand.',
        { file: z.string() },
        async ({ file }) => {
          try {
            const video = own(file, ['video']);
            if (!existsSync(WHISPER_MODEL)) return fail('Whisper is not set up yet (it installs on first launch).');
            await mkdir(workDir(id), { recursive: true });
            const wav = path.join(workDir(id), 'speech.wav');
            await run('ffmpeg', ['-v', 'error', '-y', '-t', '600', '-i', video, '-vn', '-ac', '1', '-ar', '16000', wav]);
            const said = (await run('whisper-cli', ['-m', WHISPER_MODEL, '-f', wav, '-np', '-nt', '-l', 'auto'])).trim();
            await rm(wav, { force: true });
            return text(said ? `Transcript:\n${said}` : 'Nobody speaks in it (or only music).');
          } catch (error) {
            return fail((error as Error).message);
          }
        },
      ),
      tool(
        'pdf_pages',
        'Render pages of an attached PDF as pictures (2400 px, transparent where the page is empty): to see a page as designed, or to cut a logo out of it with save_logo. Without pages, says how many there are.',
        { file: z.string(), pages: z.array(z.number().int().min(1)).max(10).optional() },
        async ({ file, pages = [] }) => {
          try {
            const pdf = own(file, ['pdf']);
            if (!existsSync(PDFPAGE_BIN)) return fail('PDF pages are not set up on this Mac: they need Apple’s command line tools (xcode-select --install). Read the PDF instead.');
            await mkdir(workDir(id), { recursive: true });
            const out = await run(PDFPAGE_BIN, [pdf, ...(pages.length ? [workDir(id), ...pages.map(String)] : [])]);
            return text(pages.length ? `Saved — Read them:\n${out.trim().split('\n').map((line) => { const [n, f, size] = line.split(' '); return `- page ${n}: ${f} (${size})`; }).join('\n')}` : out.trim());
          } catch (error) {
            return fail((error as Error).message.replace(/^.*failed \(\d+\):\n/s, ''));
          }
        },
      ),
      tool(
        'save_logo',
        'Cut a logo out of a picture (an attached image, a video_still or a pdf_pages page) and put it in a logo slot: main (full logo), mark (icon alone) or onDark (for dark backgrounds). Replaces what the slot had.',
        {
          image: z.string().describe('Path of the picture'),
          slot: z.enum(['main', 'mark', 'onDark']),
          crop: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().gt(0).max(1), h: z.number().gt(0).max(1) }).optional()
            .describe('The logo\'s box as fractions of the picture: x, y = top left; w, h = size. Omit for the whole picture.'),
        },
        async ({ image, slot, crop }) => {
          try {
            const picture = own(image, ['image']);
            const kit = await current();
            const box = crop ? { x: crop.x, y: crop.y, w: Math.min(crop.w, 1 - crop.x), h: Math.min(crop.h, 1 - crop.y) } : undefined;
            const name = freeName(id, `logo-${slot}`, '.png');
            await run('ffmpeg', ['-v', 'error', '-y', '-i', picture, ...(box ? ['-vf', `crop=iw*${box.w}:ih*${box.h}:iw*${box.x}:ih*${box.y}`] : []), '-frames:v', '1', '-pix_fmt', 'rgba', path.join(brandDir(id), name)]);
            const before = kit.logos[slot as LogoSlot];
            const saved = await saveBrand({ ...kit, logos: { ...kit.logos, [slot]: name } });
            if (before && !brandFiles(saved).includes(before)) await shell.trashItem(path.join(brandDir(id), before)).catch(() => {});
            changed(saved);
            return text(`Saved as the ${slot} logo: ${path.join(brandDir(id), name)} — Read it to check the crop.`);
          } catch (error) {
            return fail((error as Error).message);
          }
        },
      ),
      tool(
        'download_video',
        'Download a video from a link the user gave (TikTok, Instagram, YouTube, …) as an attachment, to look at with video_frames.',
        { url: z.string().url() },
        async ({ url }) => {
          try {
            await mkdir(uploads(id), { recursive: true });
            const out = await run('yt-dlp', ['--no-playlist', '--restrict-filenames', '-S', 'res:720,vcodec:h264', '--merge-output-format', 'mp4', '--print', 'after_move:filepath', '--no-simulate', '-o', path.join(uploads(id), '%(uploader,extractor)s-%(id)s.%(ext)s'), '--', url]);
            return text(`Downloaded: ${out.trim().split('\n').pop()}`);
          } catch (error) {
            return fail((error as Error).message.match(/ERROR:.*/)?.[0] ?? (error as Error).message);
          }
        },
      ),
    ],
  });
}

/** One step of Claude's, as the user reads it in the chat. */
function describe(name: string, input: Record<string, unknown>): string {
  if (name === 'mcp__brand__update_kit') {
    const keys = Object.keys(isObject(input.patch) ? input.patch : {}).map((k) => LABELS[k] ?? k);
    return keys.length ? `Setting the ${keys.join(', ')}` : 'Updating the kit';
  }
  if (name === 'mcp__brand__download_logo') return `Downloading the ${{ main: 'full logo', mark: 'icon', onDark: 'logo for dark backgrounds' }[String(input.slot)] ?? 'logo'}`;
  const file = path.basename(String(input.file ?? input.image ?? input.file_path ?? ''));
  if (name === 'mcp__brand__video_frames') return `Watching ${file}`;
  if (name === 'mcp__brand__video_still') return `Taking a still from ${file} at ${Number(input.time ?? 0).toFixed(1)} s`;
  if (name === 'mcp__brand__transcribe_video') return `Listening to ${file}`;
  if (name === 'mcp__brand__pdf_pages') return `Rendering page${(input.pages as number[] | undefined)?.length === 1 ? '' : 's'} ${(input.pages as number[] | undefined)?.join(', ') ?? ''} of ${file}`;
  if (name === 'mcp__brand__save_logo') return `Cutting out the ${{ main: 'full logo', mark: 'icon', onDark: 'logo for dark backgrounds' }[String(input.slot)] ?? 'logo'}`;
  if (name === 'mcp__brand__download_video') return 'Downloading the video';
  if (name === 'mcp__brand__find_font') return `Looking up the font ${String(input.family ?? '')}`;
  if (name === 'Read') return /\.pdf$/i.test(file) ? `Reading ${file}${input.pages ? `, pages ${String(input.pages)}` : ''}` : `Looking at ${file}`;
  if (name === 'WebFetch') return `Reading ${String(input.url ?? 'a page').replace(/^https?:\/\//, '')}`;
  if (name === 'Bash') return `Fetching ${String(/https?:\/\/\S+/.exec(String(input.command ?? ''))?.[0] ?? 'a page').replace(/^https?:\/\//, '').replace(/['"]$/, '')}`;
  if (name === 'WebSearch') return `Searching for “${String(input.query ?? '')}”`;
  return name;
}

/** Commands Claude may run: reading a web page with curl, nothing that writes or chains. */
const SAFE_CURL = /^curl\s[^;&|`$<>(){}\\\n]*$/;
const WRITES = /\s-[a-zA-Z]*[oOKTc]|--output|--remote-name|--config|--upload-file|--cookie-jar|--dump-header|--trace|--stderr/;

/** Send a message about kit `id` and stream the reply; `changed` gets the kit whenever Claude changes it. */
export async function send(id: string, text: string, files: string[], emit: (event: AgentEvent) => void, changed: (kit: BrandKit) => void): Promise<void> {
  const kit = await readBrand(id);
  if (!kit) throw new Error('This brand kit no longer exists.');
  const attached = files.filter((name) => existsSync(path.join(uploads(id), path.basename(name))));
  const { id: _id, updatedAt: _at, ...fields } = kit;
  await runner.send(id, {
    text,
    files: attached,
    prompt: `${text}${describeAttachments(id, attached)}\n\n<kit note="The kit as it is now. Logo files are in its folder; the user uploads files themselves.">\n${JSON.stringify(fields, null, 1)}\n</kit>`,
    systemPrompt: PROMPT,
    mcpServers: { brand: kitTools(id, changed) },
    allowedTools: ['WebFetch', 'WebSearch', 'mcp__brand'],
    disallowedTools: ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'AskUserQuestion', 'Task', 'TodoWrite', 'Glob', 'Grep'],
    // Bash is not allowed outright: only plain curl reads get through. Read only for the kit's own files (to look at a logo).
    canUseTool: async (name, input) => {
      const command = String(input.command ?? '').trim();
      if (name === 'Bash' && SAFE_CURL.test(command) && !WRITES.test(command)) return { behavior: 'allow', updatedInput: input };
      if (name === 'Read' && path.resolve(chatDir(id), String(input.file_path ?? '')).startsWith(brandDir(id) + path.sep)) return { behavior: 'allow', updatedInput: input };
      return { behavior: 'deny', message: 'Here you can only read web pages (WebFetch, or a plain curl) and change the kit with its tools.' };
    },
    describe,
    emit,
  });
}
