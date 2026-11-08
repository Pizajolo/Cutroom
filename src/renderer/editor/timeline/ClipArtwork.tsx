import { useEffect, useRef, useState } from 'react';
import type { TimelineItem } from '@shared/schema/timeline';
import type { MediaFile, Thumbnails, Waveform } from '@shared/schema/media';
import { sourceThumbnails, sourceWaveform } from './artwork';

export function ClipArtwork({ item, file, zoom, start, end }: { item: TimelineItem; file?: MediaFile; zoom: number; start: number; end: number }) {
  const [sprite, setSprite] = useState<Thumbnails | null>(null);
  const [waveform, setWaveform] = useState<Waveform | null>(null);
  const [failed, setFailed] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const rel = item.type === 'clip' || item.type === 'audio' ? item.src : null;
  const visibleStart = Math.max(item.start, start), visibleEnd = Math.min(item.start + item.duration, end);
  const width = Math.max(0, Math.ceil((visibleEnd - visibleStart) * zoom));
  useEffect(() => {
    let active = true;
    if (rel && file?.kind === 'video') void sourceThumbnails(rel).then((value) => { if (active) setSprite(value); });
    if (rel && item.type === 'audio') void sourceWaveform(rel).then((value) => { if (active) setWaveform(value); });
    return () => { active = false; };
  }, [rel, file?.kind, item.type]);
  useEffect(() => {
    const element = canvas.current;
    if (!element || !waveform || item.type !== 'audio' || !width) return;
    const context = element.getContext('2d');
    if (!context) return;
    const height = 32, dpr = window.devicePixelRatio || 1;
    element.width = width * dpr; element.height = height * dpr;
    context.scale(dpr, dpr); context.clearRect(0, 0, width, height);
    context.strokeStyle = getComputedStyle(element).getPropertyValue('--clip-waveform'); context.lineWidth = 1;
    context.beginPath();
    for (let x = 0; x < width; x++) {
      const source = item.in + visibleStart - item.start + x / zoom;
      const next = source + 1 / zoom;
      const from = Math.max(0, Math.floor(source * waveform.sampleRate / waveform.samplesPerPeak));
      const to = Math.min(waveform.peaks.length, Math.max(from + 1, Math.ceil(next * waveform.sampleRate / waveform.samplesPerPeak)));
      let min = 0, max = 0;
      for (let i = from; i < to; i++) { min = Math.min(min, waveform.peaks[i]!.min); max = Math.max(max, waveform.peaks[i]!.max); }
      context.moveTo(x + .5, height / 2 - max * height / 2); context.lineTo(x + .5, height / 2 - min * height / 2);
    }
    context.stroke();
  }, [waveform, item, zoom, width, visibleStart]);
  if (failed || !width || !rel) return null;
  const left = (visibleStart - item.start) * zoom;
  if (item.type === 'audio') return waveform ? <canvas ref={canvas} className="clip-waveform" style={{ left, width, height: 32 }} aria-hidden="true" /> : null;
  if (item.type !== 'clip') return null;
  if (file?.kind === 'image') return <div className="clip-filmstrip" style={{ left, width }} aria-hidden="true">{Array.from({ length: Math.ceil(width / 64) }, (_, index) => <img key={index} src={file.url} alt="" onError={() => setFailed(true)} />)}</div>;
  if (!sprite) return null;
  return <div className="clip-filmstrip" style={{ left, width }} aria-hidden="true">{Array.from({ length: Math.ceil(width / 64) }, (_, index) => {
    const source = item.in + (visibleStart - item.start + index * 64 / zoom) * item.speed;
    const frame = sprite.frames[Math.min(sprite.frames.length - 1, Math.max(0, Math.floor(source / sprite.interval)))];
    return frame ? <svg key={index} viewBox={`${frame.x} ${frame.y} ${frame.w} ${frame.h}`} preserveAspectRatio="xMidYMid slice"><image href={sprite.imageUrl} width={sprite.columns * sprite.frameWidth} height={sprite.rows * sprite.frameHeight} onError={() => setFailed(true)} /></svg> : null;
  })}</div>;
}
