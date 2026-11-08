import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TimelineItem } from '@shared/schema/timeline';
type AudioItem = Extract<TimelineItem, { type: 'audio' }>;
type ClipItem = Extract<TimelineItem, { type: 'clip' }>;
import { ClipArtwork } from '../../src/renderer/editor/timeline/ClipArtwork';
import { Timeline } from '../../src/renderer/editor/timeline/Timeline';
import { sourceThumbnails, sourceWaveform } from '../../src/renderer/editor/timeline/artwork';
import { useNavigation } from '../../src/renderer/state/navigation';
import { useEditor } from '../../src/renderer/editor/store';
import { media, session, timelineDoc } from './fixtures';
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('../../src/renderer/lib/api', () => ({ api: { invoke: mocks.invoke, on: () => () => {} } }));
const sprite = { imageRel: 'work/thumbs.jpg', imageUrl: 'data:image/jpeg;base64,', interval: 1, frameWidth: 160, frameHeight: 90, columns: 12, rows: 1, count: 12, frames: Array.from({ length: 12 }, (_, index) => ({ time: index, x: index * 160, y: 0, w: 160, h: 90 })) };
beforeEach(() => {
  useNavigation.setState({ project: null }); useNavigation.setState({ project: session });
  mocks.invoke.mockReset(); mocks.invoke.mockResolvedValue(sprite); useEditor.setState({ media: [media] });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('aligns visible filmstrips to source trim and speed, preserving aspect and caching across trims', async () => {
  const item = { ...timelineDoc().tracks.find((t) => t.id === 'video')!.items[0]!, speed: 2 } as ClipItem;
  const { container, rerender } = render(<ClipArtwork item={item} file={media} zoom={64} start={1} end={3} />);
  await waitFor(() => expect(container.querySelectorAll('svg')).toHaveLength(2));
  expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('640 0 160 90');
  expect(container.querySelector('svg')?.getAttribute('preserveAspectRatio')).toBe('xMidYMid slice');
  rerender(<ClipArtwork item={{ ...item, in: 3, out: 13 }} file={media} zoom={64} start={1} end={3} />);
  expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('800 0 160 90'); expect(mocks.invoke).toHaveBeenCalledTimes(1);
});
it('draws waveform peaks from the trimmed visible source range', async () => {
  const context = { scale: vi.fn(), clearRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), strokeStyle: '', lineWidth: 1 };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  mocks.invoke.mockResolvedValue({ sampleRate: 10, samplesPerPeak: 1, peaks: Array.from({ length: 100 }, (_, index) => ({ min: -index / 100, max: index / 100 })) });
  const item: AudioItem = { id: 'audio_0000000001', type: 'audio', src: 'audio/voice.wav', start: 0, duration: 5, in: 2, out: 7, gain: 1, fadeIn: 0, fadeOut: 0, createdBy: 'user', userEdited: [] };
  render(<ClipArtwork item={item} zoom={32} start={1} end={3} />);
  await waitFor(() => expect(context.stroke).toHaveBeenCalled());
  expect(context.moveTo).toHaveBeenCalledWith(.5, 11.2); expect(context.lineTo).toHaveBeenCalledWith(.5, 20.8);
  expect(mocks.invoke).toHaveBeenCalledWith('media.waveform', { rel: 'audio/voice.wav' });
});
it('never fetches offscreen sources or artwork for clips narrower than 24px in a 200-item edit', async () => {
  const doc = timelineDoc(), track = doc.tracks.find((t) => t.id === 'video')!, item = track.items[0]!;
  track.items = Array.from({ length: 200 }, (_, index) => ({ ...item, id: `clip_${String(index).padStart(10, '0')}`, src: `raw/${index}.mp4`, start: index * 10, duration: index ? 5 : .2 }));
  useEditor.setState({ media: track.items.map((i) => ({ ...media, rel: 'src' in i ? i.src : '' })) });
  const { container } = render(<Timeline doc={doc} apply={vi.fn()} />);
  expect(container.querySelectorAll('.timeline-item')).toHaveLength(1);
  await Promise.resolve(); expect(mocks.invoke).not.toHaveBeenCalled();
});
it('caches failures as plain-art fallback and resets caches between projects', async () => {
  mocks.invoke.mockRejectedValue(new Error('Artwork unavailable.'));
  expect(await sourceThumbnails('raw/unavailable.mp4')).toBeNull(); expect(await sourceThumbnails('raw/unavailable.mp4')).toBeNull();
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
  expect(await sourceWaveform('audio/unavailable.wav')).toBeNull();
  useNavigation.setState({ project: null });
  await sourceThumbnails('raw/unavailable.mp4'); expect(mocks.invoke).toHaveBeenCalledTimes(3);
});
