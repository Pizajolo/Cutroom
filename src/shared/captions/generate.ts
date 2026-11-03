import { nanoid } from 'nanoid';
import type { TimelineItem } from '../schema/timeline';
import type { Transcript } from '../schema/transcripts';

export function captionsForClip(clip: Extract<TimelineItem, { type: 'clip' }>, words: Transcript['words']): Extract<TimelineItem, { type: 'caption' }> {
  const duration = Math.min(clip.duration, (clip.out - clip.in) / clip.speed);
  return { type: 'caption', id: `caption_${nanoid(10)}`, start: clip.start, duration, createdBy: 'user', userEdited: [], sourceItemId: clip.id, stylePreset: 'Clean', highlight: null,
    words: words.filter((word) => word.start >= clip.in && word.end <= clip.out && word.end > word.start).map((word) => ({ id: nanoid(10), text: word.text, start: (word.start - clip.in) / clip.speed, end: Math.min(duration, (word.end - clip.in) / clip.speed), ...(word.confidence !== undefined ? { confidence: word.confidence } : {}) })).filter((word) => word.start < duration && word.end > word.start),
  };
}
