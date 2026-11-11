import type { Timeline } from '../shared/types';
import type { Block, Track } from './timelineOps';

/** A numeric property: where it lives on the item, and its sensible range. */
type Field = [path: string, label: string, step: number, fallback: number, min?: number, max?: number];

const GRADE: Field[] = [
  ['grade.brightness', 'Brightness', 0.02, 0, -1, 1],
  ['grade.contrast', 'Contrast', 0.05, 1, 0, 2],
  ['grade.saturation', 'Saturation', 0.05, 1, 0, 3],
  ['grade.temperature', 'Warmth (K)', 100, 6500, 2000, 12000],
];
const CROP: Field[] = [
  ['crop.x', 'Crop left', 0.01, 0, 0, 1],
  ['crop.y', 'Crop top', 0.01, 0, 0, 1],
  ['crop.w', 'Crop width', 0.01, 1, 0.05, 1],
  ['crop.h', 'Crop height', 0.01, 1, 0.05, 1],
];
const FADES: Field[] = [['fadeIn', 'Fade in', 0.1, 0, 0], ['fadeOut', 'Fade out', 0.1, 0, 0]];
const FIELDS: Record<Track | 'project', Field[]> = {
  project: [['width', 'Width', 2, 1080, 16], ['height', 'Height', 2, 1920, 16], ['fps', 'Frames / s', 1, 30, 1, 120], ...GRADE],
  clips: [['in', 'Start in source', 0.1, 0, 0], ['out', 'End in source', 0.1, 0, 0], ['speed', 'Speed', 0.05, 1, 0.25, 4], ['volume', 'Volume', 0.05, 1, 0, 2], ...GRADE, ...CROP],
  overlays: [
    ['at', 'Starts at', 0.1, 0, 0], ['duration', 'Length', 0.1, 1, 0.1], ['in', 'Start in source', 0.1, 0, 0],
    ['x', 'Left', 0.01, 0, -1, 1], ['y', 'Top', 0.01, 0, -1, 1], ['w', 'Width', 0.01, 1, 0.02, 2],
    ['opacity', 'Opacity', 0.05, 1, 0, 1], ['volume', 'Volume', 0.05, 0, 0, 2], ...FADES, ...GRADE, ...CROP,
  ],
  audio: [['at', 'Starts at', 0.1, 0, 0], ['in', 'Start in source', 0.1, 0, 0], ['duration', 'Length', 0.1, 1, 0.1], ['volume', 'Volume', 0.05, 1, 0, 2], ...FADES],
};

type Bag = Record<string, unknown>;
const read = (item: Bag, path: string): number | undefined => {
  const [key, sub] = path.split('.') as [string, string?];
  return (sub ? (item[key] as Bag | undefined)?.[sub] : item[key]) as number | undefined;
};
/** Set a property; crop needs all four numbers, so it starts from the whole picture. */
function write(item: Bag, path: string, value: number): void {
  const [key, sub] = path.split('.') as [string, string?];
  if (!sub) item[key] = value;
  else item[key] = { ...(key === 'crop' ? { x: 0, y: 0, w: 1, h: 1 } : {}), ...(item[key] as Bag | undefined), [sub]: value };
}

/** Numbers for the selected item — or, with nothing selected, for the whole video. */
export function Inspector({ timeline, block, onChange }: { timeline: Timeline; block?: Block; onChange: (timeline: Timeline) => void }) {
  const item = (block ? timeline[block.track][block.index] : timeline) as unknown as Bag;
  const set = (path: string, value: number): void => {
    const next = structuredClone(timeline);
    write((block ? next[block.track][block.index] : next) as unknown as Bag, path, value);
    onChange(next);
  };
  return (
    <aside className="inspector">
      <strong>{block ? block.label : 'Whole video'}</strong>
      {FIELDS[block?.track ?? 'project'].map(([path, label, step, fallback, min, max]) => (
        <label key={path}>
          {label}
          {/* Committed on Enter or when leaving the field, so typing "0.5" is not interrupted. */}
          <input
            type="number" step={step} min={min} max={max}
            key={`${block?.id}/${read(item, path)}`} defaultValue={Number((read(item, path) ?? fallback).toFixed(3))}
            onBlur={(e) => e.target.value !== '' && Number(e.target.value) !== (read(item, path) ?? fallback) && set(path, Number(e.target.value))}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
        </label>
      ))}
    </aside>
  );
}
