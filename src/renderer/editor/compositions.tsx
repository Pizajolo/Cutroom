import { useEffect, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import { Player, type PlayerRef } from '@remotion/player';
import { RemotionTitle } from '../../compositions/builtin/remotion-title/Title';
import type { TimelineDoc, TimelineItem } from '@shared/schema/timeline';
import type { InvokeRes } from '@shared/ipc';
import { propsDocSchema, type PropsDoc } from '@shared/schema/props';
import { useAppInfo } from '../lib/useAppInfo';
import { api } from '../lib/api';
import { CompositionBridge } from '../lib/compBridge';
import { errorMessage, useNavigation } from '../state/navigation';
import { Notice } from '../components/Notice';
import { Dialog } from '../components/Dialog';
import { previewClock, useClock } from './preview/store';
import { activeAt } from './preview/media';
import { useEditor } from './store';
import { useSelection } from './selection/store';
type OverlayItem = Extract<TimelineItem, { type: 'text' | 'caption' | 'composition' }>;
export function compositionUrl(base: string, projectId: string, item: OverlayItem) {
  if (item.type === 'composition') return new URL(`p/${encodeURIComponent(projectId)}/${item.path.replace(/\/$/, '').split('/').map(encodeURIComponent).join('/')}/index.html`, base).href;
  return new URL(`builtin/${item.type === 'text' ? 'text-layer' : 'captions'}/index.html`, base).href;
}
export function overlayProps(item: OverlayItem) {
  if (item.type === 'composition') return item.props;
  if (item.type === 'text') return { text: { content: item.text, fontFamily: item.style.fontFamily, fontSize: item.style.fontSize, fontWeight: item.style.fontWeight, color: item.style.color, align: item.style.align, ...item.layout } };
  return { captions: { words: JSON.stringify(item.words), preset: item.stylePreset, highlight: item.highlight ?? '#f6d36d' } };
}
function CompositionFrame({ item, base, projectId }: { item: OverlayItem; base: string; projectId: string }) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const bridge = useRef<CompositionBridge | null>(null);
  const [error, setError] = useState('');
  const url = compositionUrl(base, projectId, item);
  const props = JSON.stringify(overlayProps(item));
  const latestProps = useRef(props);
  useEffect(() => { latestProps.current = props; }, [props]);
  useEffect(() => {
    if (!iframe.current) return;
    let active = true;
    const client = new CompositionBridge(iframe.current, url, 5000, () => {
      void client.request({ command: 'load', props: JSON.parse(latestProps.current) }).then(async () => {
        if (!active) return;
        setError('');
        const clock = previewClock.getSnapshot();
        await client.request({ command: 'seek', time: Math.max(0, clock.time - item.start) });
        await client.request({ command: clock.playing ? 'play' : 'pause' });
      }).catch((r: unknown) => { if (active) setError(errorMessage(r)); });
    });
    bridge.current = client;
    let seeking = false, latest = Math.max(0, previewClock.getSnapshot().time - item.start);
    const flush = async () => {
      if (seeking) return;
      seeking = true;
      try { let sent: number; do { sent = latest; await client.request({ command: 'seek', time: sent }); } while (active && sent !== latest); }
      catch (r) { if (active) setError(errorMessage(r)); } finally { seeking = false; }
    };
    // Deterministic seeks also handle reverse/shuttle. Play/pause are mirrored to the host.
    let playing = false;
    const sync = previewClock.subscribe((clock) => {
      latest = Math.max(0, clock.time - item.start);
      if (playing !== clock.playing) { playing = clock.playing; void client.request({ command: playing ? 'play' : 'pause' }).catch((r: unknown) => { if (active) setError(errorMessage(r)); }); }
      void flush();
    });
    void flush();
    return () => { active = false; sync(); client.dispose(); bridge.current = null; };
  }, [url, item.start]);
  useEffect(() => { if (!bridge.current) return; void bridge.current.request({ command: 'setProps', props: JSON.parse(props) }).catch((r: unknown) => setError(errorMessage(r))); }, [props]);
  return <><iframe ref={iframe} sandbox="allow-scripts" className="composition-frame" title={`${item.type} preview`} />{error && <span className="composition-preview-error" role="status">{error}</span>}</>;
}
function RemotionLayer({ item, doc }: { item: Extract<TimelineItem, { type: 'composition' }>; doc: TimelineDoc }) {
  const player = useRef<PlayerRef>(null);
  useEffect(() => { const sync = () => player.current?.seekTo(Math.max(0, Math.round((previewClock.getSnapshot().time - item.start) * doc.format.fps))); sync(); return previewClock.subscribe(sync); }, [item.start, doc.format.fps]);
  if (item.compositionId !== 'Title') return <span className="composition-preview-error">Live preview for this Remotion composition isn't available yet.</span>;
  return <Player ref={player} component={RemotionTitle} inputProps={{ title: String(item.props.title?.content ?? 'Your title'), subtitle: String(item.props.subtitle?.content ?? 'A story worth sharing'), color: String(item.props.title?.color ?? '#ffffff'), fontSize: Number(item.props.title?.fontSize ?? 96) }} durationInFrames={Math.max(1, Math.ceil(item.duration * doc.format.fps))} fps={doc.format.fps} compositionWidth={doc.format.width} compositionHeight={doc.format.height} controls={false} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />;
}
export function CompositionLayers({ doc, projectId }: { doc: TimelineDoc; projectId: string }) {
  const { info } = useAppInfo();
  const time = useClock((s) => s.time);
  const tracks = ['captions', 'text', 'overlay'] as const;
  const active = tracks.flatMap((kind) => doc.tracks.find((t) => t.kind === kind)?.items.filter((i): i is OverlayItem => ['text', 'caption', 'composition'].includes(i.type) && activeAt(i, time)) ?? []);
  return <>{active.map((item) => item.type === 'composition' && item.engine === 'remotion' ? <RemotionLayer key={item.id} item={item} doc={doc} /> : info?.compBaseUrl ? <CompositionFrame key={item.id} item={item} base={info.compBaseUrl} projectId={projectId} /> : <span key={item.id} className="composition-preview-error">Composition preview is unavailable.</span>)}</>;
}
export function useCompositionSchema(item: Extract<TimelineItem, { type: 'composition' }>) {
  const { info } = useAppInfo();
  const projectId = useNavigation((s) => s.project?.project.id);
  const [result, setResult] = useState<{ url: string; schema: PropsDoc | null; error: string | null } | null>(null);
  const url = info?.compBaseUrl && projectId ? compositionUrl(info.compBaseUrl, projectId, item).replace(/index\.html$/, 'props.json') : null;
  useEffect(() => {
    if (!url) return;
    let active = true;
    void fetch(url).then((r) => { if (!r.ok) throw new Error('The editable properties could not be loaded.'); return r.json(); }).then((data: unknown) => { if (active) setResult({ url, schema: propsDocSchema.parse(data), error: null }); }).catch((r: unknown) => { if (active) setResult({ url, schema: null, error: errorMessage(r) }); });
    return () => { active = false; };
  }, [url]);
  return result?.url === url ? result : { schema: null, error: !url && info ? 'Composition properties are unavailable.' : null };
}
export function CompositionPicker({ onClose }: { onClose: () => void }) {
  const [templates, setTemplates] = useState<InvokeRes<'compositions.templates'>>([]);
  const [selected, setSelected] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [licence, setLicence] = useState(false);
  useEffect(() => { void api.invoke('compositions.templates', {}).then(setTemplates).catch((r: unknown) => setError(errorMessage(r))); }, []);
  const choose = async (id: string) => {
    setSelected(id);
    if (templates.find((t) => t.id === id)?.engine === 'remotion') { try { const settings = await api.invoke('settings.get', {}); if (!settings.remotionLicenseAcknowledgedAt) setLicence(true); } catch (r) { setError(errorMessage(r)); } }
  };
  const add = async () => {
    const timeline = useEditor.getState().timeline;
    if (!timeline || busy) return; setBusy(true); setError('');
    try {
      const settings = await api.invoke('settings.get', {});
      if (templates.find((t) => t.id === selected)?.engine === 'remotion' && !settings.remotionLicenseAcknowledgedAt) { setLicence(true); return; }
      const comp = await api.invoke('compositions.create', { template: selected, name });
      const item: TimelineItem = { type: 'composition', id: `composition_${nanoid(10)}`, start: previewClock.getSnapshot().time, duration: comp.durationSec, engine: comp.engine, path: comp.path, ...(comp.compositionId ? { compositionId: comp.compositionId } : {}), props: {}, createdBy: 'user', userEdited: [] };
      await useEditor.getState().apply([{ type: 'addItem', trackId: timeline.doc.tracks.find((t) => t.kind === 'overlay')!.id, item }], 'Add composition');
      if (!useEditor.getState().error) { useSelection.getState().select({ itemId: item.id }); onClose(); }
    } catch (r) { setError(errorMessage(r)); } finally { setBusy(false); }
  };
  return <><Dialog title="Add composition" onClose={onClose} footer={<><button className="button" onClick={onClose}>Cancel</button><button className="button primary" disabled={!selected || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name) || busy || licence} onClick={() => { void add(); }}>{busy ? 'Adding…' : 'Add composition'}</button></>}><div className="settings-form"><label className="form-field">Template<select value={selected} onChange={(e) => { void choose(e.target.value); }}><option value="">Choose a template</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name} · {t.engine}</option>)}</select></label><label className="form-field">Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="opening-title" /></label><p className="field-note">{templates.find((t) => t.id === selected)?.description}</p>{error && <Notice danger>{error}</Notice>}</div></Dialog>{licence && <Dialog title="Using Remotion" onClose={() => setLicence(false)} footer={<><button className="button" autoFocus onClick={() => { setLicence(false); setSelected(''); }}>Cancel</button><button className="button primary" onClick={() => { void api.invoke('settings.update', { patch: { remotionLicenseAcknowledgedAt: new Date().toISOString() } }).then(() => setLicence(false)).catch((r: unknown) => setError(errorMessage(r))); }}>I understand</button></>}><p>Remotion is free for individuals and companies with up to 3 people. For-profit companies with more than 3 people need a Remotion company licence. Acknowledgement is not a licence purchase. Review the official terms at remotion.dev/license.</p></Dialog>}</>;
}
