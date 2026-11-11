// Renders `.cutroom/timeline.json` to a video with a single FFmpeg filter graph.
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { PREVIEW_FILE, TIMELINE_FILE, clipLength, timelineLength } from '../shared/types';
import type { Clip, Grade, Overlay, Timeline } from '../shared/types';
import { run } from './run';

const IMAGE = /\.(png|jpe?g|webp|gif|bmp)$/i;
const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2);

/** Read and validate the project's timeline. Returns null when there is none yet. */
export async function readTimeline(root: string): Promise<Timeline | null> {
  let text: string;
  try {
    text = await readFile(path.join(root, TIMELINE_FILE), 'utf8');
  } catch {
    return null;
  }
  const t = JSON.parse(text) as Partial<Timeline>;
  const timeline: Timeline = {
    width: t.width ?? 1080,
    height: t.height ?? 1920,
    fps: t.fps ?? 30,
    grade: t.grade,
    clips: t.clips ?? [],
    overlays: t.overlays ?? [],
    audio: t.audio ?? [],
  };
  for (const item of [...timeline.clips, ...timeline.overlays, ...timeline.audio]) {
    if (!item.id || !item.src) throw new Error('Every timeline item needs an "id" and a "src".');
    if (!existsSync(path.join(root, item.src))) throw new Error(`Missing file: ${item.src}`);
  }
  const luts = [timeline.grade, ...timeline.clips.map((c) => c.grade), ...timeline.overlays.map((o) => o.grade)].flatMap((g) => g?.lut ?? []);
  for (const lut of luts) if (!existsSync(path.join(root, lut))) throw new Error(`Missing LUT: ${lut}`);
  for (const c of timeline.clips) {
    if (!(c.out > c.in) || c.in < 0) throw new Error(`Clip ${c.id}: "out" must be after "in".`);
  }
  for (const o of timeline.overlays) {
    if (!(o.duration > 0) || o.at < 0) throw new Error(`Overlay ${o.id}: needs "at" ≥ 0 and "duration" > 0.`);
  }
  return timeline;
}

async function hasAudio(file: string): Promise<boolean> {
  const out = await run('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', file]);
  return out.trim().length > 0;
}

async function nextExportPath(root: string): Promise<string> {
  const dir = path.join(root, 'exports');
  await mkdir(dir, { recursive: true });
  const name = path.basename(root).replace(/[^\w-]+/g, '-').replace(/^-+/, '') || 'export';
  const taken = new Set(await readdir(dir));
  for (let n = 1; ; n++) {
    const file = `${name}-${String(n).padStart(2, '0')}.mp4`;
    if (!taken.has(file)) return path.join(dir, file);
  }
}

/** Colour correction as FFmpeg filters. */
function gradeFilters(root: string, g: Grade = {}): string[] {
  const eq = Object.entries({ brightness: g.brightness, contrast: g.contrast, saturation: g.saturation, gamma: g.gamma })
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => `${name}=${value}`);
  return [
    ...(g.temperature ? [`colortemperature=temperature=${g.temperature}`] : []),
    ...(eq.length ? [`eq=${eq.join(':')}`] : []),
    ...(g.lut ? [`lut3d=file='${path.join(root, g.lut).replace(/[\\':]/g, '\\$&')}'`] : []),
  ];
}

/** Crop, grade and custom filters of a clip or overlay, applied to its source picture. */
function look(root: string, item: Clip | Overlay): string[] {
  const c = item.crop;
  return [
    ...(c ? [`crop=iw*${c.w}:ih*${c.h}:iw*${c.x}:ih*${c.y}`] : []),
    ...gradeFilters(root, item.grade),
    ...(item.filter ? [item.filter] : []),
  ];
}

/** Audio speed change. One atempo stage handles 0.5–2×, so chain two for the rest. */
const tempo = (speed: number): string =>
  speed === 1 ? '' : speed < 0.5 || speed > 2 ? `atempo=${Math.sqrt(speed)},atempo=${Math.sqrt(speed)},` : `atempo=${speed},`;

/** Build the FFmpeg arguments for a timeline. Exported separately so it is easy to inspect. */
export async function ffmpegArgs(root: string, t: Timeline, preview: boolean): Promise<string[]> {
  if (t.clips.length === 0) throw new Error('The timeline has no clips yet.');
  const scale = preview ? Math.min(1, 540 / Math.min(t.width, t.height)) : 1;
  const W = even(t.width * scale);
  const H = even(t.height * scale);
  const total = timelineLength(t);
  const abs = (src: string): string => path.join(root, src);
  const inputs: string[] = [];
  const graph: string[] = [];
  let n = 0;

  const AUDIO = 'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo';
  const fades = (prefix: '' | 'a', item: { fadeIn?: number; fadeOut?: number }, length: number): string[] => [
    ...(item.fadeIn ? [`${prefix}fade=t=in:st=0:d=${item.fadeIn}${prefix ? '' : ':alpha=1'}`] : []),
    ...(item.fadeOut ? [`${prefix}fade=t=out:st=${Math.max(0, length - item.fadeOut)}:d=${item.fadeOut}${prefix ? '' : ':alpha=1'}`] : []),
  ];

  // Main track: normalise every clip to the output format, then concatenate.
  const pads: string[] = [];
  for (const c of t.clips) {
    const len = clipLength(c);
    const speed = c.speed || 1;
    const image = IMAGE.test(c.src);
    inputs.push(...(image ? ['-loop', '1'] : ['-ss', String(c.in)]), '-t', String(c.out - c.in), '-i', abs(c.src));
    const fit = c.fit === 'contain'
      ? `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2`
      : `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`;
    graph.push(`[${n}:v]${[...look(root, c), fit, 'setsar=1', `setpts=(PTS-STARTPTS)/${speed}`, `fps=${t.fps}`, 'format=yuv420p'].join(',')}[v${n}]`);
    graph.push(
      !image && (await hasAudio(abs(c.src)))
        ? `[${n}:a]${AUDIO},${tempo(speed)}volume=${c.volume ?? 1},apad,atrim=duration=${len},asetpts=PTS-STARTPTS[a${n}]`
        : `anullsrc=r=48000:cl=stereo,atrim=duration=${len}[a${n}]`,
    );
    pads.push(`[v${n}][a${n}]`);
    n++;
  }
  graph.push(`${pads.join('')}concat=n=${t.clips.length}:v=1:a=1[cat][a]`);
  graph.push(`[cat]${gradeFilters(root, t.grade).join(',') || 'null'}[v]`);

  // Overlays: b-roll, picture-in-picture, cutouts and graphics, composited in order.
  let video = 'v';
  const mix = ['[a]'];
  for (const o of t.overlays) {
    const image = IMAGE.test(o.src);
    inputs.push(...(image ? ['-loop', '1'] : ['-ss', String(o.in ?? 0)]), '-t', String(o.duration), '-i', abs(o.src));
    const chain = [
      ...look(root, o),
      `scale=${o.w ? `${even(o.w * W)}:-2` : `${W}:${H}`}`,
      `fps=${t.fps}`,
      'format=rgba',
      ...(o.key ? [`chromakey=${o.key.replace('#', '0x')}:0.15:0.08`] : []),
      ...(o.opacity !== undefined && o.opacity < 1 ? [`colorchannelmixer=aa=${o.opacity}`] : []),
      ...fades('', o, o.duration),
      `setpts=PTS-STARTPTS+${o.at}/TB`,
    ];
    graph.push(`[${n}:v]${chain.join(',')}[o${n}]`);
    graph.push(
      `[${video}][o${n}]overlay=${Math.round((o.x ?? 0) * W)}:${Math.round((o.y ?? 0) * H)}:` +
        `eof_action=pass:enable='between(t,${o.at},${o.at + o.duration})'[v${n}]`,
    );
    if (o.volume && !image && (await hasAudio(abs(o.src)))) {
      graph.push(`[${n}:a]${[AUDIO, `volume=${o.volume}`, ...fades('a', o, o.duration), `adelay=${Math.round(o.at * 1000)}:all=1`].join(',')}[m${n}]`);
      mix.push(`[m${n}]`);
    }
    video = `v${n}`;
    n++;
  }

  // Extra audio: delayed into place and mixed under the clip audio.
  for (const a of t.audio) {
    const duration = Math.min(a.duration ?? Infinity, total - a.at);
    if (duration <= 0) continue;
    inputs.push('-ss', String(a.in ?? 0), '-t', String(duration), '-i', abs(a.src));
    graph.push(`[${n}:a]${[AUDIO, `volume=${a.volume ?? 1}`, ...fades('a', a, duration), `adelay=${Math.round(a.at * 1000)}:all=1`].join(',')}[m${n}]`);
    mix.push(`[m${n}]`);
    n++;
  }
  let audio = 'a';
  if (mix.length > 1) {
    graph.push(`${mix.join('')}amix=inputs=${mix.length}:duration=first:normalize=0[mix]`);
    audio = 'mix';
  }

  return [
    '-hide_banner', '-loglevel', 'error', '-y', ...inputs,
    '-filter_complex', graph.join(';'), '-map', `[${video}]`, '-map', `[${audio}]`,
    '-c:v', 'libx264', '-preset', preview ? 'ultrafast' : 'medium', '-crf', preview ? '28' : '18',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-t', String(total),
  ];
}

/** Render the timeline. Returns the path of the written file. */
export async function render(root: string, opts: { preview?: boolean; signal?: AbortSignal } = {}): Promise<string> {
  const timeline = await readTimeline(root);
  if (!timeline) throw new Error(`No timeline yet. Write ${TIMELINE_FILE} first.`);
  const out = opts.preview ? path.join(root, PREVIEW_FILE) : await nextExportPath(root);
  // Write next to the target, then rename, so a half-written file is never played or shipped.
  const tmp = path.join(path.dirname(out), `.rendering-${process.pid}-${path.basename(out)}`);
  const args = await ffmpegArgs(root, timeline, opts.preview ?? false);
  await run('ffmpeg', [...args, '-f', 'mp4', tmp], { signal: opts.signal });
  await rename(tmp, out);
  return out;
}
