// Renders a cut's timeline.json to a video with a single FFmpeg filter graph.
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { clipLength, cutFiles, timelineLength } from '../shared/types';
import type { Clip, Grade, Overlay, Timeline } from '../shared/types';
import { addVersion, linkExport, readCuts } from './project';
import { run } from './run';

const IMAGE = /\.(png|jpe?g|webp|gif|bmp)$/i;
const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2);

/** Read and validate a cut's timeline. Returns null when there is none yet. */
export async function readTimeline(root: string, cut: string): Promise<Timeline | null> {
  let text: string;
  try {
    text = await readFile(path.join(root, cutFiles(cut).timeline), 'utf8');
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

/**
 * HDR footage (iPhone HLG, HDR10) looks washed out when treated as normal video, so it is converted to
 * standard range first. FFmpeg does this through macOS's own converter (VideoToolbox).
 */
export const HDR_TO_SDR = 'format=p010le,hwupload,scale_vt=color_matrix=bt709:color_primaries=bt709:color_transfer=bt709,hwdownload,format=p010le';
const hdrCache = new Map<string, Promise<boolean>>();
export function isHdr(file: string): Promise<boolean> {
  if (!hdrCache.has(file)) {
    const probe = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=color_transfer', '-of', 'csv=p=0', file]);
    hdrCache.set(file, probe.then((out) => /smpte2084|arib-std-b67/.test(out), () => false));
  }
  return hdrCache.get(file)!;
}

/** `exports/trip-01.mp4` for the first cut, `exports/trip-german-01.mp4` for one called "German". */
async function nextExportPath(root: string, cut: string): Promise<string> {
  const dir = path.join(root, 'exports');
  await mkdir(dir, { recursive: true });
  const cuts = await readCuts(root);
  const label = cuts[0]?.id === cut ? '' : (cuts.find((c) => c.id === cut)?.name ?? cut);
  const name = [path.basename(root), label].filter(Boolean).join('-').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'export';
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
async function look(root: string, item: Clip | Overlay): Promise<string[]> {
  const c = item.crop;
  return [
    ...(!IMAGE.test(item.src) && (await isHdr(path.join(root, item.src))) ? [HDR_TO_SDR] : []),
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
    graph.push(`[${n}:v]${[...(await look(root, c)), fit, 'setsar=1', `setpts=(PTS-STARTPTS)/${speed}`, `fps=${t.fps}`, 'format=yuv420p'].join(',')}[v${n}]`);
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
      ...(await look(root, o)),
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
    '-hide_banner', '-loglevel', 'error', '-y', '-init_hw_device', 'videotoolbox=vt', '-filter_hw_device', 'vt', ...inputs,
    '-filter_complex', graph.join(';'), '-map', `[${video}]`, '-map', `[${audio}]`,
    '-c:v', 'libx264', '-preset', preview ? 'ultrafast' : 'medium', '-crf', preview ? '28' : '18',
    '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-t', String(total),
  ];
}

/** Render a cut's timeline. Returns the path of the written file. `onProgress` gets the share that is done, 0–1. */
export async function render(
  root: string,
  cut: string,
  opts: { preview?: boolean; signal?: AbortSignal; onProgress?: (done: number) => void } = {},
): Promise<string> {
  const timeline = await readTimeline(root, cut);
  if (!timeline) throw new Error(`No timeline yet. Write ${cutFiles(cut).timeline} first.`);
  const out = opts.preview ? path.join(root, cutFiles(cut).preview) : await nextExportPath(root, cut);
  // Write next to the target, then rename, so a half-written file is never played or shipped.
  const tmp = path.join(path.dirname(out), `.rendering-${process.pid}-${path.basename(out)}`);
  const args = await ffmpegArgs(root, timeline, opts.preview ?? false);
  const total = timelineLength(timeline);
  try {
    // `-progress` reports the output time reached (in microseconds, under either name) about twice a second.
    await run('ffmpeg', [...args, ...(opts.onProgress ? ['-progress', 'pipe:1', '-nostats'] : []), '-f', 'mp4', tmp], {
      signal: opts.signal,
      onOutput: (chunk) => {
        const at = [...chunk.matchAll(/out_time_(?:us|ms)=(\d+)/g)].at(-1)?.[1];
        if (at) opts.onProgress?.(Math.min(1, Number(at) / 1e6 / total));
      },
    });
    await rename(tmp, out);
  } catch (error) {
    // A cancelled or failed render leaves nothing behind.
    await rm(tmp, { force: true });
    throw error;
  }
  if (!opts.preview) {
    await linkExport(root, out);
    await addVersion(root, cut, 'Export', timeline, path.relative(root, out));
  }
  return out;
}
