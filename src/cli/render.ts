// Renders a cut's timeline.json to a video with a single FFmpeg filter graph.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_LOUDNESS, clipLength, cutFiles, playState, timelineLength } from '../shared/types';
import type { Clip, Grade, Overlay, Timeline } from '../shared/types';
import { levelLoudness } from './loudness';
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
    tracks: t.tracks,
    loudness: t.loudness,
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
  for (const item of [...timeline.clips, ...timeline.overlays]) {
    if (item.speed !== undefined && !(item.speed > 0)) throw new Error(`${item.id}: "speed" must be above 0.`);
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

/**
 * Crop and custom filters of a clip or overlay, applied to its source picture (`file`).
 * The grade is applied separately, after scaling: it works pixel by pixel, so the result is the same
 * on far fewer pixels (grading 4K footage for a 540p preview was most of the render time).
 */
async function look(file: string, item: Clip | Overlay): Promise<string[]> {
  const c = item.crop;
  return [
    ...(!IMAGE.test(item.src) && (await isHdr(file)) ? [HDR_TO_SDR] : []),
    ...(c ? [`crop=iw*${c.w}:ih*${c.h}:iw*${c.x}:ih*${c.y}`] : []),
    ...(item.filter ? [item.filter] : []),
  ];
}

// --- Proxies -------------------------------------------------------------------------------
// Previews are built from light 720p copies of heavy footage (4K, HEVC, 10-bit, HDR), as in any pro
// editor. Each is made once per source file and kept in .cutroom/proxies/. Exports use the originals.

const PROXY = 720; // short side, pixels
const ALPHA = /^(yuva|rgba|argb|bgra|abgr|gbrap|ya)/;
type ProxyJob = { promise: Promise<string | null>; done: number };
const proxyJobs = new Map<string, ProxyJob>();

async function probe(file: string): Promise<{ width: number; height: number; pixFmt: string; duration: number } | null> {
  const out = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,pix_fmt:format=duration', '-of', 'json', file]).catch(() => '');
  const json = out ? (JSON.parse(out) as { streams?: { width: number; height: number; pix_fmt: string }[]; format?: { duration?: string } }) : {};
  const v = json.streams?.[0];
  return v ? { width: v.width, height: v.height, pixFmt: v.pix_fmt, duration: Number(json.format?.duration) || 0 } : null;
}

/** Start (or join) making the proxy for one source. Resolves with its path, or null when the original is light enough. */
function proxyJob(root: string, src: string): ProxyJob {
  const file = path.join(root, src);
  const known = proxyJobs.get(file);
  if (known) return known;
  const job: ProxyJob = { done: 0, promise: Promise.resolve(null) };
  job.promise = (async () => {
    const info = await probe(file);
    if (!info || Math.min(info.width, info.height) <= PROXY * 1.1 || ALPHA.test(info.pixFmt)) return null;
    const { size, mtimeMs } = await stat(file);
    const name = createHash('sha1').update(`${src}|${size}|${mtimeMs}`).digest('hex').slice(0, 16);
    const out = path.join(root, '.cutroom', 'proxies', `${name}.mp4`);
    if (existsSync(out)) return out;
    await mkdir(path.dirname(out), { recursive: true });
    const k = PROXY / Math.min(info.width, info.height);
    const [w, h] = [even(info.width * k), even(info.height * k)];
    const hdr = await isHdr(file);
    const tmp = `${out}.part.mp4`;
    const encode = ['-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'h264_videotoolbox', '-b:v', '5M', '-g', '30', '-c:a', 'aac', '-b:a', '160k', '-progress', 'pipe:1', '-nostats', tmp];
    const onOutput = (chunk: string): void => {
      const at = [...chunk.matchAll(/out_time_(?:us|ms)=(\d+)/g)].at(-1)?.[1];
      if (at && info.duration) job.done = Math.min(1, Number(at) / 1e6 / info.duration);
    };
    try {
      // Decode, scale and encode without the frames leaving the graphics chip (light on the CPU);
      // HDR is colour-converted on the way. Downloading 10-bit frames to the CPU here fails.
      const colour = hdr ? ':color_matrix=bt709:color_primaries=bt709:color_transfer=bt709' : '';
      await run('ffmpeg', ['-v', 'error', '-y', '-hwaccel', 'videotoolbox', '-hwaccel_output_format', 'videotoolbox_vld', '-i', file, '-vf', `scale_vt=w=${w}:h=${h}${colour},fps=30`, ...encode], { onOutput });
    } catch {
      // Fallback: hardware decoding, scaling on the CPU.
      job.done = 0;
      await run('ffmpeg', ['-v', 'error', '-y', '-init_hw_device', 'videotoolbox=vt', '-filter_hw_device', 'vt', '-hwaccel', 'videotoolbox', '-i', file, '-vf', `${hdr ? `${HDR_TO_SDR},` : ''}scale=${w}:${h},fps=30,format=yuv420p`, ...encode], { onOutput });
    }
    await rename(tmp, out);
    return out;
  })()
    .catch((error) => {
      proxyJobs.delete(file); // try again next time
      console.error(`Proxy for ${src} failed:`, error);
      return null;
    })
    .finally(() => (job.done = 1));
  proxyJobs.set(file, job);
  return job;
}

/** Proxies for every video in the timeline, as a map from `src` to the file to read instead. `onProgress` gets 0–1. */
export async function proxies(root: string, t: Timeline, onProgress?: (done: number) => void): Promise<Map<string, string>> {
  const srcs = [...new Set([...t.clips, ...t.overlays].map((i) => i.src).filter((src) => !IMAGE.test(src)))];
  const jobs = srcs.map((src) => proxyJob(root, src));
  const timer = onProgress && setInterval(() => onProgress(jobs.reduce((sum, j) => sum + j.done, 0) / Math.max(1, jobs.length)), 500);
  try {
    const files = await Promise.all(jobs.map((j) => j.promise));
    return new Map(srcs.flatMap((src, i) => (files[i] ? [[src, files[i]] as [string, string]] : [])));
  } finally {
    clearInterval(timer);
  }
}

/** Audio speed change. One atempo stage handles 0.5–2×, so chain two for the rest. */
const tempo = (speed: number): string =>
  speed === 1 ? '' : speed < 0.5 || speed > 2 ? `atempo=${Math.sqrt(speed)},atempo=${Math.sqrt(speed)},` : `atempo=${speed},`;

/** The ducking key (see ffmpegArgs) sits this many dB above the compressor's threshold while someone talks. */
const DUCK_OVER = 24;
const DUCK_THRESHOLD = 0.0158; // -36 dBFS: the limited key at -12 dBFS is DUCK_OVER above it

/** Build the FFmpeg arguments for a timeline. Exported separately so it is easy to inspect. */
export async function ffmpegArgs(root: string, t: Timeline, preview: boolean, sources: Map<string, string> = new Map()): Promise<string[]> {
  if (t.clips.length === 0) throw new Error('The timeline has no clips yet.');
  const scale = preview ? Math.min(1, 540 / Math.min(t.width, t.height)) : 1;
  const W = even(t.width * scale);
  const H = even(t.height * scale);
  const total = timelineLength(t);
  const abs = (src: string): string => sources.get(src) ?? path.join(root, src);
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
    const { visible, audible } = playState(t, 'clips', c);
    inputs.push(...(image ? ['-loop', '1'] : ['-ss', String(c.in)]), '-t', String(c.out - c.in), '-i', abs(c.src));
    const fit = c.fit === 'contain'
      ? `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2`
      : `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`;
    graph.push(`[${n}:v]${[...(await look(abs(c.src), c)), fit, ...gradeFilters(root, c.grade), 'setsar=1', `setpts=(PTS-STARTPTS)/${speed}`, `fps=${t.fps}`,
      // A hidden clip keeps its place in the running order, as black.
      ...(visible ? [] : ['drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill']), 'format=yuv420p'].join(',')}[v${n}]`);
    graph.push(
      audible && !image && (await hasAudio(abs(c.src)))
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
  // `[speech]` is the main track's sound; music that ducks listens to a copy of it (see below).
  const mix = ['[speech]'];
  const ducked: { label: string; db: number }[] = [];
  for (const o of t.overlays) {
    const image = IMAGE.test(o.src);
    const speed = image ? 1 : o.speed || 1;
    const { visible, audible } = playState(t, 'overlays', o);
    const heard = audible && !!o.volume && !image && (await hasAudio(abs(o.src)));
    if (!visible && !heard) continue;
    inputs.push(...(image ? ['-loop', '1'] : ['-ss', String(o.in ?? 0)]), '-t', String(o.duration * speed), '-i', abs(o.src));
    const chain = [
      ...(await look(abs(o.src), o)),
      `scale=${o.w ? `${even(o.w * W)}:-2` : `${W}:${H}`}`,
      ...gradeFilters(root, o.grade),
      `fps=${t.fps}`,
      'format=rgba',
      ...(o.key ? [`chromakey=${o.key.replace('#', '0x')}:0.15:0.08`] : []),
      ...(o.opacity !== undefined && o.opacity < 1 ? [`colorchannelmixer=aa=${o.opacity}`] : []),
      // Speed first, so the fades below are timed in output seconds.
      ...(speed === 1 ? [] : [`setpts=(PTS-STARTPTS)/${speed}`]),
      ...fades('', o, o.duration),
      `setpts=PTS-STARTPTS+${o.at}/TB`,
    ];
    if (visible) {
      graph.push(`[${n}:v]${chain.join(',')}[o${n}]`);
      graph.push(
        `[${video}][o${n}]overlay=${Math.round((o.x ?? 0) * W)}:${Math.round((o.y ?? 0) * H)}:` +
          `eof_action=pass:enable='between(t,${o.at},${o.at + o.duration})'[v${n}]`,
      );
      video = `v${n}`;
    }
    if (heard) {
      graph.push(`[${n}:a]${[AUDIO, ...(speed === 1 ? [] : [tempo(speed).slice(0, -1)]), `volume=${o.volume}`, ...fades('a', o, o.duration), `adelay=${Math.round(o.at * 1000)}:all=1`].join(',')}[m${n}]`);
      mix.push(`[m${n}]`);
    }
    n++;
  }

  // Extra audio: delayed into place and mixed under the clip audio.
  for (const a of t.audio) {
    const duration = Math.min(a.duration ?? Infinity, total - a.at);
    if (duration <= 0 || !playState(t, 'audio', a).audible) continue;
    inputs.push('-ss', String(a.in ?? 0), '-t', String(duration), '-i', abs(a.src));
    graph.push(`[${n}:a]${[AUDIO, `volume=${a.volume ?? 1}`, ...fades('a', a, duration), `adelay=${Math.round(a.at * 1000)}:all=1`].join(',')}[m${n}]`);
    if (a.duck) ducked.push({ label: `m${n}`, db: a.duck === true ? 10 : Math.min(20, Math.max(3, a.duck)) });
    else mix.push(`[m${n}]`);
    n++;
  }

  // Ducking: a compressor on the music that listens to the speech. The speech it listens to is first turned into a
  // steady "someone is talking" signal (gated against room noise, boosted, limited), so the dip is as deep for a quiet
  // speaker as for a loud one: the key sits DUCK_OVER dB above the threshold, and the ratio sets the dip.
  if (ducked.length) {
    graph.push(`[a]asplit=2[speech][talk]`);
    graph.push(`[talk]highpass=f=120,lowpass=f=5000,agate=threshold=0.008:range=0:attack=5:release=250,volume=40dB,alimiter=limit=0.25:level=0,asplit=${ducked.length}${ducked.map((_, i) => `[key${i}]`).join('')}`);
  } else graph.push('[a]anull[speech]');
  for (const [i, d] of ducked.entries()) {
    const ratio = (DUCK_OVER / Math.max(1, DUCK_OVER - d.db)).toFixed(2);
    graph.push(`[${d.label}][key${i}]sidechaincompress=threshold=${DUCK_THRESHOLD}:ratio=${ratio}:attack=20:release=500:knee=1[duck${i}]`);
    mix.push(`[duck${i}]`);
  }
  let audio = 'speech';
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
  opts: { preview?: boolean; signal?: AbortSignal; onProgress?: (done: number, stage: 'proxies' | 'render') => void } = {},
): Promise<string> {
  const timeline = await readTimeline(root, cut);
  if (!timeline) throw new Error(`No timeline yet. Write ${cutFiles(cut).timeline} first.`);
  const out = opts.preview ? path.join(root, cutFiles(cut).preview) : await nextExportPath(root, cut);
  // Write in the cut's folder, then rename, so a half-written file is never played or shipped. Not as a dotfile
  // next to the target: macOS can give a dotfile the hidden flag, and a rename keeps it, so exports came out hidden.
  const tmp = path.join(root, cutFiles(cut).dir, `rendering-${process.pid}-${path.basename(out)}`);
  const sources = opts.preview ? await proxies(root, timeline, (done) => opts.onProgress?.(done, 'proxies')) : undefined;
  if (opts.signal?.aborted) throw new Error('Cancelled.');
  const args = await ffmpegArgs(root, timeline, opts.preview ?? false, sources);
  const total = timelineLength(timeline);
  try {
    // `-progress` reports the output time reached (in microseconds, under either name) about twice a second.
    await run('ffmpeg', [...args, ...(opts.onProgress ? ['-progress', 'pipe:1', '-nostats'] : []), '-f', 'mp4', tmp], {
      signal: opts.signal,
      onOutput: (chunk) => {
        const at = [...chunk.matchAll(/out_time_(?:us|ms)=(\d+)/g)].at(-1)?.[1];
        if (at) opts.onProgress?.(Math.min(1, Number(at) / 1e6 / total), 'render');
      },
    });
    // Level the mix for the feed: platforms play everything at about -14 LUFS, so a quiet video sounds weak next to others.
    if (timeline.loudness !== false) await levelLoudness(tmp, timeline.loudness ?? DEFAULT_LOUDNESS, opts.signal);
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
