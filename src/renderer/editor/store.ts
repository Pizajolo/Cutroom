import { create } from 'zustand';
import { nanoid } from 'nanoid';
import type { TimelineState } from '@shared/schema/editor';
import type { MediaFile } from '@shared/schema/media';
import type { TimelineItem, Track } from '@shared/schema/timeline';
import type { Op } from '@shared/timeline/types';
import { IpcFailure } from '@shared/ipc';
import { api } from '../lib/api';
import { errorMessage, useNavigation } from '../state/navigation';
import { previewClock } from './preview/store';
import { useSelection } from './selection/store';

interface EditorState {
  timeline: TimelineState | null;
  media: MediaFile[];
  error: string | null;
  pending: boolean;
  reload: () => Promise<void>;
  loadMedia: () => Promise<void>;
  apply: (ops: Op[], label: string) => Promise<boolean>;
  history: (direction: 'undo' | 'redo') => Promise<void>;
}
let epoch = 0;
const duration = (state: TimelineState) => Math.max(0, ...state.doc.tracks.flatMap((t) => t.items.map((i) => i.start + i.duration)));
function accept(state: TimelineState, generation = epoch) {
  if (generation !== epoch) return;
  const previous = useEditor.getState().timeline;
  if (previous && previous.revision > state.revision) return;
  useEditor.setState({ timeline: state });
  previewClock.configure(duration(state), state.doc.format.fps);
}
export const useEditor = create<EditorState>((set, get) => ({
  timeline: null, media: [], error: null, pending: false,
  reload: async () => {
    const generation = epoch;
    try { accept(await api.invoke('timeline.get', {}), generation); }
    catch (r) { if (generation === epoch) set({ error: errorMessage(r) }); }
  },
  loadMedia: async () => {
    const generation = epoch;
    try { const media = await api.invoke('media.list', {}); if (generation === epoch) set({ media }); }
    catch (r) { if (generation === epoch) set({ error: errorMessage(r) }); }
  },
  apply: async (ops, label) => {
    if (get().pending) return false;
    const generation = epoch;
    set({ pending: true, error: null });
    try { accept(await api.invoke('timeline.apply', { ops, label, baseRevision: get().timeline?.revision }), generation); return generation === epoch; }
    catch (r) {
      if (generation !== epoch) return false;
      if (r instanceof IpcFailure && r.code === 'conflict') {
        await get().reload();
        if (generation === epoch) set({ error: 'The edit changed elsewhere. The latest revision is loaded; your selection is kept. Try your change again.' });
      } else set({ error: errorMessage(r) });
      return false;
    } finally { if (generation === epoch) set({ pending: false }); }
  },
  history: async (direction) => {
    if (get().pending) return;
    const generation = epoch;
    set({ pending: true, error: null });
    try { accept(await api.invoke(direction === 'undo' ? 'timeline.undo' : 'timeline.redo', {}), generation); }
    catch (r) { if (generation === epoch) set({ error: errorMessage(r) }); }
    finally { if (generation === epoch) set({ pending: false }); }
  },
}));
useNavigation.subscribe((next, previous) => {
  if (next.project?.project.id === previous.project?.project.id) return;
  epoch++;
  useEditor.setState({ timeline: null, media: [], error: null, pending: false });
  useSelection.setState({ elements: [] });
  previewClock.pause(); previewClock.configure(0, next.project?.project.format.fps ?? 30); previewClock.seek(0);
});
export function connectEditor() {
  const generation = epoch;
  const off = api.on('timeline.changed', (event) => {
    if (generation !== epoch) return;
    const previous = useEditor.getState().timeline;
    accept({ doc: event.doc, revision: event.revision, canUndo: previous?.canUndo ?? true, canRedo: previous?.canRedo ?? false }, generation);
    void useEditor.getState().reload();
  });
  const offMedia = api.on('media.changed', () => { if (generation === epoch) void useEditor.getState().loadMedia(); });
  void useEditor.getState().reload(); void useEditor.getState().loadMedia();
  return () => { off(); offMedia(); previewClock.pause(); };
}
export const quantize = (time: number, fps: number) => Math.max(0, Math.round(time * fps) / fps);
export function mediaItem(file: MediaFile, start: number, fps: number): TimelineItem {
  // Never round a source out-point beyond the last available source sample.
  const sourceDuration = file.kind === 'image' ? 5 : file.probe?.duration ?? 0;
  const duration = Math.floor((sourceDuration + 1e-9) * fps) / fps;
  if (duration < 1 / fps) throw new Error('This source has no usable duration. Check its media probe before adding it.');
  const common = { start: quantize(start, fps), duration, createdBy: 'user' as const, userEdited: [] };
  return file.kind === 'audio' ? { ...common, id: `audio_${nanoid(10)}`, type: 'audio', src: file.rel, in: 0, out: duration, gain: 0, fadeIn: 0, fadeOut: 0 } : { ...common, id: `clip_${nanoid(10)}`, type: 'clip', src: file.rel, in: 0, out: duration, speed: 1, volume: 1, muted: false };
}
export async function addMedia(file: MediaFile, at?: number, track?: Track): Promise<boolean> {
  const generation = epoch;
  try {
    if (!['video', 'audio', 'image'].includes(file.kind)) throw new Error('This file type cannot be added to the timeline.');
    let state = useEditor.getState().timeline;
    if (!state) { state = await api.invoke('timeline.get', {}); accept(state, generation); }
    if (generation !== epoch) return false;
    const target = track ?? state.doc.tracks.find((t) => t.kind === (file.kind === 'audio' ? 'music' : 'video'));
    if (!target) throw new Error('The destination track is unavailable.');
    const item = mediaItem(file, at ?? duration(state), state.doc.format.fps);
    const applied = await useEditor.getState().apply([{ type: 'addItem', trackId: target.id, item }], `Add ${file.name}`);
    if (applied) useSelection.getState().select({ itemId: item.id });
    return applied;
  } catch (r) { if (generation === epoch) useEditor.setState({ error: errorMessage(r) }); return false; }
}
export function addText() {
  const state = useEditor.getState().timeline;
  if (!state) return;
  const item: TimelineItem = { type: 'text', id: `text_${nanoid(10)}`, start: quantize(previewClock.getSnapshot().time, state.doc.format.fps), duration: 3, createdBy: 'user', userEdited: [], text: 'Your text', style: { fontFamily: 'sans-serif', fontSize: 64, fontWeight: 600, color: '#ffffff', align: 'center' }, layout: { x: 0.1, y: 0.4, w: 0.8, h: 0.2, rotation: 0, anchor: 'top-left' }, animation: { in: 'fade', out: 'fade', inDuration: 0.25, outDuration: 0.25, easing: 'power2.out' } };
  void useEditor.getState().apply([{ type: 'addItem', trackId: state.doc.tracks.find((t) => t.kind === 'text')!.id, item }], 'Add text').then((applied) => { if (applied) useSelection.getState().select({ itemId: item.id }); });
}
