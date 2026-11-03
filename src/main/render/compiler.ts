import type { ExportPreset, TimeRange } from '@shared/schema/export';
import type { TimelineDoc, TimelineItem } from '@shared/schema/timeline';
import { isTrackEnabled } from '@shared/timeline/visibility';
import { INPUT_RESTRICTIONS } from '../media/process';

export interface RenderSource { path: string; hasAudio: boolean; kind: 'image' | 'video' | 'audio' | 'other' }
export interface RenderPlan { args: string[]; filterGraph: string; duration: number; width: number; height: number; fps: number }
const n = (value: number): string => Number(value.toFixed(9)).toString();
export function atempo(speed: number): string[] {
  if (!Number.isFinite(speed) || speed <= 0) throw new Error('Invalid speed');
  const filters: string[] = []; while (speed < 0.5) { filters.push('atempo=0.5'); speed *= 2; } while (speed > 2) { filters.push('atempo=2'); speed /= 2; } filters.push(`atempo=${n(speed)}`); return filters;
}
export function activeItems(doc: TimelineDoc): { track: string; item: TimelineItem }[] {
  return doc.tracks.filter((track) => isTrackEnabled(track, doc.tracks)).flatMap((track) => track.items.map((item) => ({ track: track.kind, item })));
}
export interface OverlaySource { path: string }
export function unsupportedItems(doc: TimelineDoc) {
  return activeItems(doc).filter(({ item, track }) => !((item.type === 'clip' && (track === 'video' || track === 'broll') && !item.color?.lut && item.reframe?.mode !== 'track' && !item.behindSubject) || (item.type === 'audio' && !item.ducking?.enabled) || ((item.type === 'text' || item.type === 'composition' || item.type === 'caption') && !('behindSubject' in item && item.behindSubject)))).map(({ item }) => ({ itemId: item.id, type: item.type, name: item.type === 'composition' ? item.path : item.type === 'text' ? item.text.slice(0, 80) : item.type === 'clip' ? `${item.src} (unsupported effect)` : item.type }));
}
export function compileRender(doc: TimelineDoc, preset: ExportPreset, sources: Readonly<Record<string, RenderSource>>, output: string, range?: TimeRange, overlays: Readonly<Record<string, OverlaySource>> = {}): RenderPlan {
  const end = range?.end ?? Math.max(0, ...activeItems(doc).map(({ item }) => item.start + item.duration)); const start = range?.start ?? 0;
  if (end <= start) throw new Error('The timeline is empty');
  const size = preset.size === 'project' ? doc.format : preset.size; const width = size.width; const height = size.height; const fps = preset.fps === 'project' ? doc.format.fps : preset.fps;
  if (width % 2 || height % 2) throw new Error('Export dimensions must be even');
  const items = activeItems(doc).filter(({ item }) => item.start < end && item.start + item.duration > start);
  const supported = items.filter(({ item, track }) => (item.type === 'clip' && (track === 'video' || track === 'broll')) || item.type === 'audio');
  const args: string[] = ['-hide_banner', '-nostdin', '-n'];
  for (const { item } of supported) {
    if (item.type !== 'clip' && item.type !== 'audio') continue;
    const source = sources[item.src]; if (!source) throw new Error('Source media is missing'); args.push(...INPUT_RESTRICTIONS, '-i', source.path);
  }
  const overlayItems = items.filter(({ item }) => overlays[item.id]);
  for (const { item } of overlayItems) args.push(...INPUT_RESTRICTIONS, '-i', overlays[item.id]!.path);
  const graph: string[] = [`color=c=black:s=${width}x${height}:r=${n(fps)}:d=${n(end)}[base]`, `anullsrc=r=48000:cl=stereo,atrim=duration=${n(end)}[silence]`];
  const audio: string[] = ['[silence]']; let visual = 'base'; let visualIndex = 0;
  const visualOrder = supported.map((entry, input) => ({ ...entry, input })).filter(({ item }) => item.type === 'clip').sort((a, b) => (a.track === 'broll' ? 1 : 0) - (b.track === 'broll' ? 1 : 0));
  for (const { item, input } of visualOrder) {
    if (item.type !== 'clip') continue;
    const mode = item.reframe?.mode ?? preset.fit; const fit = mode === 'fill' ? 'max' : 'min'; const scale = item.reframe?.scale ?? 1;
    // A still has one frame, not a finite source duration. Extend before trimming so
    // nonzero source in-points and speed changes hold it for the whole clip.
    const filters = sources[item.src]?.kind === 'image' ? [`tpad=stop_mode=clone:stop_duration=${n(item.out)}`] : [];
    filters.push(`trim=start=${n(item.in)}:end=${n(item.out)}`, `setpts=(PTS-STARTPTS)/${n(item.speed)}+${n(item.start)}/TB`);
    if (item.crop) filters.push(`crop=w='max(2,trunc(iw*${n(item.crop.w)}/2)*2)':h='max(2,trunc(ih*${n(item.crop.h)}/2)*2)':x='iw*${n(item.crop.x)}':y='ih*${n(item.crop.y)}'`);
    if (item.color) {
      filters.push(`lutrgb=r='clip(val*${n(2 ** item.color.exposure)},0,255)':g='clip(val*${n(2 ** item.color.exposure)},0,255)':b='clip(val*${n(2 ** item.color.exposure)},0,255)'`, `eq=contrast=${n(item.color.contrast)}:saturation=${n(item.color.saturation)}`, `colortemperature=temperature=${n(Math.max(1000, Math.min(40000, item.color.temperature)))}`);
    }
    filters.push(`scale=w='max(2,trunc(iw*${fit}(${width}/iw,${height}/ih)*${n(scale)}/2)*2)':h='max(2,trunc(ih*${fit}(${width}/iw,${height}/ih)*${n(scale)}/2)*2)'`, 'setsar=1', `fps=${n(fps)}`);
    graph.push(`[${input}:v]${filters.join(',')}[clip${input}]`);
    const next = `v${visualIndex++}`; const x = item.reframe?.x ?? 0.5; const y = item.reframe?.y ?? 0.5;
    graph.push(`[${visual}][clip${input}]overlay=x='${n(x * width)}-w/2':y='${n(y * height)}-h/2':eof_action=pass:repeatlast=0:enable='gte(t,${n(item.start)})*lt(t,${n(item.start + item.duration)})'[${next}]`); visual = next;
  }
  const overlayOrder = ['captions', 'text', 'overlay'];
  for (const { item, input } of overlayItems.map((entry, index) => ({ ...entry, input: supported.length + index })).sort((a, b) => overlayOrder.indexOf(a.track) - overlayOrder.indexOf(b.track))) {
    graph.push(`[${input}:v]trim=duration=${n(item.duration)},setpts=PTS-STARTPTS+${n(item.start)}/TB,scale=${width}:${height},setsar=1,format=rgba[overlay${input}]`);
    const next = `v${visualIndex++}`;
    graph.push(`[${visual}][overlay${input}]overlay=eof_action=pass:repeatlast=0:enable='gte(t,${n(item.start)})*lt(t,${n(item.start + item.duration)})'[${next}]`); visual = next;
  }
  supported.forEach(({ item }, input) => {
    if (item.type !== 'clip' && item.type !== 'audio') return;
    if (!sources[item.src]?.hasAudio || (item.type === 'clip' && item.muted)) return;
    const filters = [`atrim=start=${n(item.in)}:end=${n(item.out)}`, 'asetpts=PTS-STARTPTS', ...atempo(item.type === 'clip' ? item.speed : 1), `atrim=duration=${n(item.duration)}`, `volume=${item.type === 'clip' ? n(item.volume) : `${n(item.gain)}dB`}`];
    if (item.type === 'audio') { if (item.fadeIn) filters.push(`afade=t=in:st=0:d=${n(item.fadeIn)}`); if (item.fadeOut) filters.push(`afade=t=out:st=${n(Math.max(0, item.duration - item.fadeOut))}:d=${n(item.fadeOut)}`); }
    filters.push('aresample=48000', 'aformat=channel_layouts=stereo', `adelay=${Math.round(item.start * 1000)}:all=1`); graph.push(`[${input}:a]${filters.join(',')}[a${input}]`); audio.push(`[a${input}]`);
  });
  graph.push(`[${visual}]trim=start=${n(start)}:end=${n(end)},setpts=PTS-STARTPTS,format=yuv420p[vout]`);
  graph.push(`${audio.join('')}amix=inputs=${audio.length}:duration=longest:normalize=0,atrim=start=${n(start)}:end=${n(end)},asetpts=PTS-STARTPTS,loudnorm=I=-14:TP=-1:LRA=11,aresample=48000[aout]`);
  const filterGraph = graph.join(';'); args.push('-filter_complex_threads', '1', '-filter_complex', filterGraph, '-map', '[vout]', '-map', '[aout]');
  if (preset.vcodec === 'prores') args.push('-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le');
  else { args.push('-c:v', preset.vcodec === 'hevc' ? 'libx265' : 'libx264', '-preset', preset.id === 'draft' ? 'veryfast' : 'medium', '-pix_fmt', 'yuv420p'); if (preset.vcodec === 'hevc') args.push('-tag:v', 'hvc1'); if (preset.crf !== undefined) args.push('-crf', String(preset.crf)); else args.push('-b:v', `${preset.bitrateKbps}k`); }
  if (preset.id === 'youtube' && preset.vcodec === 'h264') args.push('-profile:v', 'high');
  args.push('-c:a', preset.audio.codec, '-ar', '48000'); if (preset.audio.codec === 'aac') args.push('-b:a', '192k');
  if (preset.container === 'mp4') args.push('-movflags', '+faststart');
  args.push('-t', n(end - start), '-r', n(fps), '-progress', 'pipe:1', '-nostats', '-f', preset.container === 'mp4' ? 'mp4' : 'mov', output);
  return { args, filterGraph, duration: end - start, width, height, fps };
}

export class ProgressParser {
  private pending = ''; private seconds = 0;
  constructor(private readonly duration: number, private readonly report: (progress: number, phase: string) => void) {}
  push(chunk: string): void {
    this.pending += chunk; const lines = this.pending.split(/\r?\n/); this.pending = lines.pop() ?? '';
    for (const line of lines) { const [key, value] = line.split('='); if (key === 'out_time_us' && value && Number.isFinite(Number(value))) this.seconds = Math.max(this.seconds, Number(value) / 1e6); if (key === 'progress') this.report(Math.min(0.99, this.seconds / this.duration), value === 'end' ? 'Finishing' : 'Encoding'); }
  }
}
