import { useState } from 'react';
import type { TimelineItem, Track } from '@shared/schema/timeline';
import { useSelection } from './selection/store';
import { useEditor } from './store';
import { Notice } from '../components/Notice';
import { useCompositionSchema } from './compositions';
export function Inspector() {
  const selection = useSelection((s) => s.elements);
  const state = useEditor((s) => s.timeline);
  const track = state?.doc.tracks.find((t) => t.items.some((i) => i.id === selection[0]?.itemId));
  const item = track?.items.find((i) => i.id === selection[0]?.itemId);
  return item && track ? <ItemInspector key={`${item.id}-${state?.revision}`} item={item} track={track} /> : <div className="inspector-content"><div className="panel-heading"><h2>Project</h2></div><p className="field-note">Select a clip or element to see its editable properties.</p></div>;
}
function NumberField({ label, value, commit, min, max, step = 'any' }: { label: string; value: number; commit: (n: number) => void; min?: number; max?: number; step?: number | 'any' }) {
  const [draft, setDraft] = useState(String(value));
  const valid = Number.isFinite(Number(draft)) && draft !== '' && (min === undefined || Number(draft) >= min) && (max === undefined || Number(draft) <= max);
  return <label className="form-field">{label}<input type="number" value={draft} min={min} max={max} step={step} aria-invalid={!valid} onChange={(e) => setDraft(e.target.value)} onBlur={() => { if (valid && Number(draft) !== value) commit(Number(draft)); }} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />{!valid && <small className="field-error">Enter a value{min === undefined ? '' : ` ≥ ${min}`}{max === undefined ? '' : ` and ≤ ${max}`}.</small>}</label>;
}
function CompositionProperties({ item, patch }: { item: Extract<TimelineItem, { type: 'composition' }>; patch: (values: Record<string, unknown>) => void }) {
  const { schema, error } = useCompositionSchema(item);
  if (error) return <Notice danger>{error}</Notice>;
  if (!schema) return <p role="status">Loading editable properties…</p>;
  if (!schema.elements.length) return <p className="field-note">This composition has no editable elements</p>;
  return <><h3>Editable properties</h3>{schema.elements.map((element) => <fieldset key={element.id}><legend>{element.name}</legend>{Object.entries(element.props).map(([key, prop]) => {
    const value = item.props[element.id]?.[key] ?? prop.default;
    const update = (v: unknown) => patch({ props: { [element.id]: { [key]: v } } });
    if (prop.type === 'number') return <NumberField key={key} label={key} value={Number(value)} min={prop.min} max={prop.max} commit={update} />;
    if (prop.type === 'enum') return <label key={key} className="form-field">{key}<select value={String(value)} onChange={(e) => update(e.target.value)}>{prop.options?.map((option) => <option key={option}>{option}</option>)}</select></label>;
    if (prop.type === 'boolean') return <label key={key} className="check-row"><input type="checkbox" checked={!!value} onChange={(e) => update(e.target.checked)} />{key}</label>;
    return <label key={key} className="form-field">{key}<input type={prop.type === 'color' ? 'color' : 'text'} defaultValue={String(value)} onBlur={(e) => { if (e.target.value !== value) update(e.target.value); }} /></label>;
  })}</fieldset>)}</>;
}
function ItemInspector({ item, track }: { item: TimelineItem; track: Track }) {
  const doc = useEditor((s) => s.timeline?.doc);
  const file = useEditor((s) => s.media.find((f) => 'src' in item && f.rel === item.src));
  const [error, setError] = useState('');
  const patch = (values: Record<string, unknown>) => {
    const nested: Record<string, unknown> = {};
    for (const [path, value] of Object.entries(values)) {
      const keys = path.split('.');
      if (keys.some((key) => ['__proto__', 'constructor', 'prototype'].includes(key))) return;
      let cursor = nested;
      keys.forEach((key, index) => { if (index === keys.length - 1) cursor[key] = value; else { cursor[key] ??= {}; cursor = cursor[key] as Record<string, unknown>; } });
    }
    void useEditor.getState().apply([{ type: 'setProps', itemId: item.id, patch: nested }], `Update ${item.type}`);
  };
  const field = (label: string, value: number, key: string, min?: number, max?: number) => <NumberField label={label} value={value} min={min} max={max} commit={(n) => patch({ [key]: n })} />;
  return <div className="inspector-content"><div className="panel-heading"><h2>{item.type === 'clip' ? file?.name ?? 'Clip' : item.type}</h2></div><div className="inspector-fields">
    <h3>Timing</h3><NumberField label="Start (s)" value={item.start} min={0} commit={(start) => { void useEditor.getState().apply([{ type: 'moveItem', itemId: item.id, start }], 'Move item'); }} />
    {item.type === 'clip' || item.type === 'audio' ? <><h3>{item.type === 'clip' ? 'Clip' : 'Audio'}</h3><NumberField label="In (source s)" value={item.in} min={0} max={item.out - 1 / (doc?.format.fps ?? 30)} commit={(n) => patch({ in: n, duration: (item.out - n) / (item.type === 'clip' ? item.speed : 1) })} /><NumberField label="Out (source s)" value={item.out} min={item.in + 1 / (doc?.format.fps ?? 30)} max={file?.probe?.duration} commit={(n) => patch({ out: n, duration: (n - item.in) / (item.type === 'clip' ? item.speed : 1) })} /><NumberField label="Duration (s)" value={item.duration} min={1 / (doc?.format.fps ?? 30)} max={file?.probe ? (file.probe.duration - item.in) / (item.type === 'clip' ? item.speed : 1) : undefined} commit={(n) => patch({ duration: n, out: item.in + n * (item.type === 'clip' ? item.speed : 1) })} />{item.type === 'clip' ? <>{<NumberField label="Speed (×)" value={item.speed} min={0.01} commit={(n) => patch({ speed: n, duration: (item.out - item.in) / n })} />}<NumberField label="Volume (dB)" value={item.volume > 0 ? 20 * Math.log10(item.volume) : -96} commit={(n) => patch({ volume: 10 ** (n / 20) })} /><label className="check-row"><input type="checkbox" checked={item.muted} onChange={(e) => patch({ muted: e.target.checked })} />Mute clip</label></> : <>{field('Gain (dB)', item.gain, 'gain')}{field('Fade in (s)', item.fadeIn, 'fadeIn', 0, item.duration)}{field('Fade out (s)', item.fadeOut, 'fadeOut', 0, item.duration)}</>}<label className="check-row"><input type="checkbox" checked={track.muted} onChange={(e) => { void useEditor.getState().apply([{ type: 'setTrack', trackId: track.id, muted: e.target.checked }], 'Mute track'); }} />Mute {track.name} track</label></> : <>{field('Duration (s)', item.duration, 'duration', 1 / (doc?.format.fps ?? 30))}</>}
    {item.type === 'text' && <><h3>Text</h3><label className="form-field">Content<textarea defaultValue={item.text} onBlur={(e) => { if (e.target.value !== item.text) patch({ text: e.target.value }); }} /></label><label className="form-field">Font<input defaultValue={item.style.fontFamily} onBlur={(e) => patch({ 'style.fontFamily': e.target.value })} /></label>{field('Size (px)', item.style.fontSize, 'style.fontSize', 1)}{field('Weight', item.style.fontWeight, 'style.fontWeight', 100, 1000)}<label className="form-field">Colour<input type="color" defaultValue={item.style.color} onBlur={(e) => patch({ 'style.color': e.target.value })} /></label><label className="form-field">Alignment<select value={item.style.align} onChange={(e) => patch({ 'style.align': e.target.value })}>{['left', 'center', 'right'].map((v) => <option key={v}>{v}</option>)}</select></label><h3>Layout · output pixels</h3>{(['x', 'y', 'w', 'h'] as const).map((key) => { const dimension = key === 'x' || key === 'w' ? doc!.format.width : doc!.format.height; return <NumberField key={key} label={`${key.toUpperCase()} (px)`} value={item.layout[key] * dimension} min={key === 'w' || key === 'h' ? 1 : undefined} commit={(n) => patch({ [`layout.${key}`]: n / dimension })} />; })}</>}
    {item.type === 'caption' && <><h3>Captions</h3><label className="form-field">Style<select value={item.stylePreset} onChange={(e) => patch({ stylePreset: e.target.value })}>{['Clean', 'Bold pop', 'Karaoke', 'Boxed'].map((s) => <option key={s}>{s}</option>)}</select></label>{item.words.map((word, index) => <div className="caption-word-row" key={word.id}><label className="form-field">Word<input defaultValue={word.text} onBlur={(e) => { const words = item.words.map((w, i) => i === index ? { ...w, text: e.target.value } : w); patch({ words }); }} /></label>{(['start', 'end'] as const).map((key) => <div key={key}><NumberField label={`${key} (s)`} value={word[key]} min={0} max={item.duration} commit={(n) => { const words = item.words.map((w, i) => i === index ? { ...w, [key]: n } : w); if (words.some((w, i) => w.end < w.start || (i > 0 && w.start < words[i - 1]!.end))) { setError('Word times must be monotonic; each end must be at or after its start.'); return; } setError(''); patch({ words }); }} /><div className="form-row">{[-1, 1].map((direction) => <button key={direction} className="button" aria-label={`${direction < 0 ? 'Decrease' : 'Increase'} ${word.text} ${key} by one frame`} onClick={() => { const n = word[key] + direction / (doc?.format.fps ?? 30); const words = item.words.map((w, i) => i === index ? { ...w, [key]: n } : w); if (words.some((w, i) => w.start < 0 || w.end > item.duration || w.end < w.start || i > 0 && w.start < words[i - 1]!.end)) { setError('Word times must be monotonic; each end must be at or after its start.'); return; } patch({ words }); }}>{direction < 0 ? '−1f' : '+1f'}</button>)}</div></div>)}</div>)}</>}
    {item.type === 'composition' && <CompositionProperties item={item} patch={patch} />}
    {error && <Notice danger>{error}</Notice>}<div className="form-row"><button className="button" onClick={() => { void useEditor.getState().apply([{ type: 'deleteItem', itemId: item.id }], 'Delete item'); }}>Delete</button><button className="button" onClick={() => { void useEditor.getState().apply([{ type: 'rippleDelete', itemId: item.id }], 'Ripple delete (this track only)'); }}>Ripple delete</button></div>
  </div></div>;
}
