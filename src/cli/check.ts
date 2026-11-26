// `cutroom check`: the technical pass an editor does before handing a video over. It finds things a viewer would
// notice (a flash of black, frozen picture, dead air, a late hook, clipped or quiet sound) and things in the edit that
// can't be right (layers running past the end, one-frame clips), with times so they can be looked at.
import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_LOUDNESS, clipLength, clipStarts, cutFiles, timelineLength } from '../shared/types';
import type { Timeline } from '../shared/types';
import { TRUE_PEAK, lufs, measureLoudness } from './loudness';
import { readTimeline, render } from './render';
import { run } from './run';

const IMAGE = /\.(png|jpe?g|webp|gif|bmp)$/i;
const t = (s: number): string => `${s.toFixed(1)}s`;
const span = (a: number, b: number): string => `${t(a)}–${t(b)}`;

interface Range {
  start: number;
  end: number;
}

/** Black frames, frozen picture and silence, from one decoding pass. */
async function scan(file: string): Promise<{ black: Range[]; frozen: Range[]; silent: Range[] }> {
  let err = '';
  await run('ffmpeg', [
    '-hide_banner', '-nostats', '-i', file,
    '-vf', 'blackdetect=d=0.2:pix_th=0.10,freezedetect=n=0.003:d=1.5', '-af', 'silencedetect=n=-45dB:d=0.8',
    '-f', 'null', '-',
  ], { onStderr: (chunk) => (err += chunk) });
  const numbers = (re: RegExp): number[] => [...err.matchAll(re)].map((m) => Number(m[1]));
  const pair = (starts: number[], ends: number[], last: number): Range[] => starts.map((start, i) => ({ start, end: ends[i] ?? last }));
  const black = [...err.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map((m) => ({ start: Number(m[1]), end: Number(m[2]) }));
  const duration = Number(/Duration: (\d+):(\d+):([\d.]+)/.exec(err)?.slice(1).reduce((s, v) => s * 60 + Number(v), 0) ?? 0);
  return {
    black,
    frozen: pair(numbers(/freeze_start: ([\d.]+)/g), numbers(/freeze_end: ([\d.]+)/g), duration),
    silent: pair(numbers(/silence_start: (-?[\d.]+)/g).map((s) => Math.max(0, s)), numbers(/silence_end: ([\d.]+)/g), duration),
  };
}

interface Probe {
  duration: number;
  width: number;
  height: number;
  fps: number;
  audio: boolean;
}

async function probe(file: string): Promise<Probe> {
  const out = await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,avg_frame_rate:format=duration', '-of', 'json', file]);
  const json = JSON.parse(out) as { streams: { codec_type: string; width?: number; height?: number; avg_frame_rate?: string }[]; format: { duration?: string } };
  const video = json.streams.find((s) => s.codec_type === 'video');
  const [num = 0, den = 1] = (video?.avg_frame_rate ?? '0/1').split('/').map(Number);
  return {
    duration: Number(json.format.duration) || 0,
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    fps: den ? num / den : 0,
    audio: json.streams.some((s) => s.codec_type === 'audio'),
  };
}

/** Where the edit puts still pictures (images, graphics): frozen picture there is expected. */
function stills(tl: Timeline): Range[] {
  const starts = clipStarts(tl);
  return [
    ...tl.clips.flatMap((c, i) => (IMAGE.test(c.src) ? [{ start: starts[i] ?? 0, end: (starts[i] ?? 0) + clipLength(c) }] : [])),
    ...tl.overlays.filter((o) => IMAGE.test(o.src) && !o.w).map((o) => ({ start: o.at, end: o.at + o.duration })),
  ];
}
const covered = (r: Range, by: Range[]): boolean => by.some((s) => s.start <= r.start + 0.1 && s.end >= r.end - 0.1);

/** Problems in the edit itself, before anything is rendered. */
function editFindings(tl: Timeline): string[] {
  const total = timelineLength(tl);
  const found: string[] = [];
  const starts = clipStarts(tl);
  for (const [i, c] of tl.clips.entries()) {
    if (clipLength(c) < 0.2) found.push(`Clip "${c.id}" at ${t(starts[i] ?? 0)} is only ${clipLength(c).toFixed(2)}s long — reads as a flash frame.`);
  }
  for (const o of tl.overlays) {
    if (o.at >= total) found.push(`Layer "${o.id}" starts at ${t(o.at)}, after the video ends (${t(total)}): it is never seen.`);
    else if (o.at + o.duration > total + 0.05) found.push(`Layer "${o.id}" runs to ${t(o.at + o.duration)}, past the end (${t(total)}): it is cut off.`);
  }
  for (const a of tl.audio) {
    if (a.at >= total) found.push(`Audio "${a.id}" starts at ${t(a.at)}, after the video ends: it is never heard.`);
  }
  const speech = tl.clips.some((c) => !IMAGE.test(c.src) && (c.volume ?? 1) > 0 && !c.muted);
  const beds = tl.audio.filter((a) => !a.duck && !a.muted && (a.duration ?? total - a.at) > Math.min(8, total * 0.5) && (a.volume ?? 1) > 0.25);
  if (speech && beds.length) {
    found.push(`Long audio ${beds.map((a) => `"${a.id}"`).join(', ')} plays under the main track at volume above 0.25 without "duck": if it is music, set "duck": true so it dips under speech.`);
  }
  return found;
}

/**
 * Check a rendered video (default: the chat's preview, rendered first if the edit changed) and the edit behind it.
 * Returns a report with times; an empty list of warnings is not a verdict on the creative work.
 */
export async function check(root: string, cut: string, file?: string): Promise<string> {
  const tl = await readTimeline(root, cut);
  let target = file ? path.resolve(root, file) : path.join(root, cutFiles(cut).preview);
  if (!file) {
    const timelineFile = path.join(root, cutFiles(cut).timeline);
    const stale = !existsSync(target) || (existsSync(timelineFile) && (await stat(timelineFile)).mtimeMs > (await stat(target)).mtimeMs);
    if (stale) target = await render(root, cut, { preview: true });
  }
  if (!existsSync(target)) throw new Error(`No video at ${path.relative(root, target)}.`);
  const [info, { black, frozen, silent }, loud] = await Promise.all([probe(target), scan(target), measureLoudness(target)]);
  const ok: string[] = [];
  const warn: string[] = [];
  const end = info.duration;

  ok.push(`${path.relative(root, target)}: ${t(end)}, ${info.width}×${info.height}, ${Math.round(info.fps)} fps${info.audio ? '' : ', no sound'}.`);

  // Picture
  const flashes = black.filter((b) => b.start > 0.05 && b.end < end - 0.05);
  if (flashes.length) warn.push(`Black picture at ${flashes.map((b) => span(b.start, b.end)).join(', ')} — a gap, a hidden clip or a missing file?`);
  const opensBlack = black.find((b) => b.start <= 0.05);
  if (opensBlack) warn.push(`The video opens on black (${span(0, opensBlack.end)}): the first frame is the thumbnail and the hook — start on picture.`);
  const stuck = frozen.filter((f) => !(tl && covered(f, stills(tl))));
  if (stuck.length) warn.push(`Picture doesn't move at ${stuck.map((f) => span(f.start, f.end)).join(', ')} — fine for a title or a held frame; otherwise the footage froze or ran out.`);
  if (!flashes.length && !stuck.length) ok.push('No flashes of black or frozen picture.');

  // Sound
  if (info.audio && loud) {
    const target = tl?.loudness === false ? undefined : (tl?.loudness ?? DEFAULT_LOUDNESS);
    if (!Number.isFinite(loud.integrated)) warn.push('The sound track is silent.');
    else {
      const level = `Loudness ${lufs(loud.integrated)}, peaks ${loud.truePeak.toFixed(1)} dBTP`;
      if (loud.truePeak > TRUE_PEAK + 0.3) warn.push(`${level}: peaks above ${TRUE_PEAK} dBTP will distort after the platform re-encodes it — lower the loudest item or keep levelling on.`);
      else if (target !== undefined && Math.abs(loud.integrated - target) > 1.5) warn.push(`${level}: the target is ${target} LUFS. Render again to level it.`);
      else if (loud.integrated < -18) warn.push(`${level}: quieter than most videos in the feed (about -14 LUFS).`);
      else ok.push(`${level}.`);
    }
    const dead = silent.filter((s) => s.end - s.start >= 0.8);
    const opening = dead.find((s) => s.start <= 0.05);
    if (opening && opening.end > 0.7) warn.push(`Nothing is heard for the first ${t(opening.end)}: viewers decide in the first second — start on the first word or a sound.`);
    const middle = dead.filter((s) => s !== opening && s.end < end - 0.05);
    if (middle.length) warn.push(`Silence at ${middle.map((s) => span(s.start, s.end)).join(', ')} — dead air, unless it is a deliberate pause.`);
    if (!opening && !middle.length) ok.push('No dead air.');
  } else if (!info.audio) warn.push('The video has no sound track.');

  // The edit
  if (tl && !file) warn.push(...editFindings(tl));
  else if (tl && file) warn.push(...editFindings(tl).map((w) => `(current edit) ${w}`));

  return [
    'Checked:',
    ...ok.map((line) => `  ✓ ${line}`),
    ...(warn.length ? ['Look at:', ...warn.map((line) => `  ⚠ ${line}`)] : ['Nothing to look at.']),
    'These are technical checks. Still watch the moments you changed.',
  ].join('\n');
}
