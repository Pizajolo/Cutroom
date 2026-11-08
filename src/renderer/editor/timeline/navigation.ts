import { nanoid } from 'nanoid';
import { previewClock } from '../preview/store';
import { useSelection } from '../selection/store';
import { useEditor } from '../store';

export function jumpEdit(direction: -1 | 1, markers = false) {
  const doc = useEditor.getState().timeline?.doc;
  if (!doc) return;
  const clock = previewClock.getSnapshot();
  const edges = markers ? doc.markers.map((m) => m.time) : [0, clock.duration, ...doc.tracks.flatMap((t) => t.items.flatMap((i) => [i.start, i.start + i.duration]))];
  const targets = edges.filter((time) => direction > 0 ? time > clock.time + .5 / clock.fps : time < clock.time - .5 / clock.fps);
  if (targets.length) previewClock.seek(direction > 0 ? Math.min(...targets) : Math.max(...targets));
}
export function jumpSeconds(seconds: number) { previewClock.seek(previewClock.getSnapshot().time + seconds); }
function loopRange() {
  const { duration } = previewClock.getSnapshot(), range = useSelection.getState().range;
  return range && range.start < duration && range.end > range.start ? range : { start: 0, end: duration };
}
export function toggleLoop() {
  const clock = previewClock.getSnapshot();
  if (clock.loop) previewClock.setLoop(null);
  else if (clock.duration) previewClock.setLoop(loopRange());
}
export function setBoundary(edge: 'start' | 'end') {
  const range = useSelection.getState().range;
  const { time, duration } = previewClock.getSnapshot();
  useSelection.getState().setRange(edge === 'start' ? time : range?.start ?? 0, edge === 'end' ? time : range?.end ?? duration);
}
export function addMarker() { const { time } = previewClock.getSnapshot(); void useEditor.getState().apply([{ type: 'addMarker', marker: { id: `marker_${nanoid(10)}`, time, label: 'Marker', kind: 'marker' } }], 'Add marker'); }
useSelection.subscribe((next, previous) => {
  if (next.range === previous.range || !previewClock.getSnapshot().loop) return;
  const { duration } = previewClock.getSnapshot();
  if (duration) previewClock.setLoop(loopRange());
});
