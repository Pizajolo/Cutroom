import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { ArrowLeft, Check, ChevronDown, Download, LayoutTemplate, PenTool, FileText, FolderOpen, Music, Package, Pencil, Plus, Trash2, Upload, Volume2, X } from 'lucide-react';
import { ASPECTS, fontMatches, isDark } from '../shared/brand';
import type { BrandFont, BrandKit, BrandSlot, LogoSlot } from '../shared/brand';
import type { ChatMessage, FontLookup, Voice } from '../shared/types';
import { ClaudeBubble, foldEvent } from './ClaudeBubble';
import { LogoEditor } from './LogoEditor';
import { LayoutFrame, fileUrl, fontFamily, useBrandFonts } from './LayoutFrame';
import { LayoutStudio } from './LayoutStudio';
import { LogoStudio } from './LogoStudio';
import { api, failed } from './lib';

/** Two frames in the kit's look: a moment in the video, and the end card. Sizes follow the kit (cqh = % of frame height). */
export function BrandPreview({ kit, onLayout }: { kit: BrandKit; onLayout?: () => void }) {
  useBrandFonts(kit);
  const { colors } = kit;
  const size = ASPECTS[kit.format.aspect || '9:16'];
  const heading: CSSProperties = { fontFamily: fontFamily(kit, 'heading', kit.fonts.heading), fontWeight: kit.fonts.heading.weight };
  const body: CSSProperties = { fontFamily: fontFamily(kit, 'body', kit.fonts.body), fontWeight: kit.fonts.body.weight };
  // As in the brand guidelines: on a dark card only the light logo reads; without one, the name stands in.
  const endLogo = isDark(colors.primary) ? kit.logos.onDark : (kit.logos.main ?? kit.logos.mark);
  const endInk = isDark(colors.primary) ? '#ffffff' : '#1d1c1a';

  return (
    <div className="brand-preview" aria-label="Preview of the brand kit">
      <figure>
        <button type="button" className="frame-button" title="Open the layout studio" disabled={!onLayout} onClick={onLayout}>
          <LayoutFrame kit={kit} />
        </button>
        <figcaption>In the video{onLayout ? ' · click to change the layout' : ''}</figcaption>
      </figure>
      <figure>
        <div className="frame end" style={{ aspectRatio: `${size.width} / ${size.height}`, background: colors.primary }}>
          {kit.endCard.on ? (
            <>
              {endLogo ? <img src={fileUrl(kit, endLogo)} alt="" /> : <strong style={{ ...heading, color: endInk, fontSize: `${kit.layout.title.size}cqh`, textAlign: 'center' }}>{kit.name}</strong>}
              {kit.endCard.line && <span style={{ ...body, color: endInk, fontSize: '3.5cqh' }}>{kit.endCard.line}</span>}
            </>
          ) : (
            <span className="hint">No end card</span>
          )}
        </div>
        <figcaption>End card</figcaption>
      </figure>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

function Pick<T extends string>({ value, options, onChange, label }: { value: T; options: Record<T, string>; onChange: (value: T) => void; label?: string }) {
  return (
    <select value={value} aria-label={label} onChange={(e) => onChange(e.target.value as T)}>
      {(Object.entries(options) as [T, string][]).map(([key, text]) => <option key={key} value={key}>{text}</option>)}
    </select>
  );
}

/**
 * Under a font's name: whether the file is there, whether the family is free to download (and a button to do it),
 * or, for a font that is not free, similar free ones to pick.
 */
function FontStatus({ font, onFetch, onPick }: { font: BrandFont; onFetch: () => Promise<void>; onPick: (family: string) => Promise<void> }) {
  const [look, setLook] = useState<FontLookup | 'checking' | 'error' | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!font.family.trim()) return setLook(null);
    setLook('checking');
    const timer = setTimeout(() => void api.lookupFont(font.family).then(setLook, () => setLook('error')), 450);
    return () => clearTimeout(timer);
  }, [font.family]);
  const run = (label: string, fn: () => Promise<void>): void => {
    setBusy(label);
    setError('');
    fn().catch((e: Error) => setError(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))).finally(() => setBusy(''));
  };
  if (busy) return <p className="font-status working">{busy}</p>;
  if (error) return <p className="font-status error">{error}</p>;
  if (fontMatches(font)) {
    return font.source
      ? <p className="font-status ok"><Check size={12} /> {font.source.family} {font.source.weight} is in the kit · {font.source.license} · {font.source.library}</p>
      : null;
  }
  if (look === 'checking') return <p className="font-status">Checking whether {font.family} is a free font…</p>;
  if (look === 'error') return <p className="font-status">Could not check the free font libraries. Are you online?</p>;
  if (!look) return null;
  if (look.found) {
    return (
      <p className="font-status">
        {look.found.family} is free on {look.found.library} ({look.found.license}).
        <button type="button" onClick={() => run(`Downloading ${look.found!.family}…`, onFetch)}><Download size={12} /> Download {font.file ? `weight ${font.weight}` : 'it'}</button>
      </p>
    );
  }
  return (
    <p className="font-status">
      {font.family} is not a free font: upload the file{look.suggestions.length ? (look.lookalikes ? ', or use a free look-alike:' : ', or use a free one:') : '.'}
      {look.suggestions.map((name) => (
        <button key={name} type="button" className="ghost" title={`Use ${name} and download it`} onClick={() => run(`Downloading ${name}…`, () => onPick(name))}>{name}</button>
      ))}
    </p>
  );
}

const LOGOS: Record<LogoSlot, string> = { main: 'Full logo', mark: 'Icon only', onDark: 'For dark backgrounds' };
const WEIGHTS = [300, 400, 500, 600, 700, 800, 900];

/** One kit's form, saved as you type, next to its preview. */
function BrandEditor({ initial, fresh, onBack, onChange }: { initial: BrandKit; /** Just made: Claude's chat opens to help fill it in. */ fresh?: boolean; onBack: () => void; onChange: (kits?: BrandKit[]) => void }) {
  const [kit, setKit] = useState(initial);
  const [status, setStatus] = useState<'saved' | 'saving' | 'error'>('saved');
  const [voices, setVoices] = useState<Voice[] | null>(null);
  const [editing, setEditing] = useState<LogoSlot | ''>('');
  const [studio, setStudio] = useState(false);
  const [layoutStudio, setLayoutStudio] = useState(false);
  /** The export menu, and the last export (or what went wrong). */
  const [exportMenu, setExportMenu] = useState(false);
  const [exportState, setExportState] = useState<{ busy?: string; file?: string; error?: string }>({});
  // Claude's chat about this kit: what it changes shows in the form at once.
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [asking, setAsking] = useState(false);
  const [chatOpen, setChatOpen] = useState(!!fresh);
  /** Files dropped anywhere on the page: they go to Claude's chat. */
  const [dropped, setDropped] = useState<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef(kit);
  latest.current = kit;

  useEffect(() => {
    void api.getSettings().then((s) => {
      if (s.elevenlabs.mode === 'off' || !s.elevenlabs.apiKey) return setVoices([]);
      void api.voices(s.elevenlabs.apiKey).then(setVoices, () => setVoices([]));
    });
    void api.brandChat(initial.id).then(setChat);
    const off = [
      api.on('brand-agent', ({ kit: id, event }) => {
        if (id !== initial.id) return;
        setChat((all) => foldEvent(all, event));
        if (event.type === 'done') setAsking(false);
      }),
      // Claude changed the kit: show it. A change typed in the last moment gives way to Claude's.
      api.on('brand', (next) => {
        if (next.id !== initial.id) return;
        clearTimeout(timer.current);
        timer.current = undefined;
        setKit(next);
        setStatus('saved');
      }),
    ];
    return () => off.forEach((stop) => stop());
  }, []);
  // Whatever is waiting is saved when leaving.
  useEffect(() => () => {
    if (timer.current) {
      clearTimeout(timer.current);
      void api.saveBrand(latest.current).then(() => onChange());
    }
  }, []);

  const save = (next: BrandKit): void => {
    setStatus('saving');
    timer.current = undefined;
    void api.saveBrand(next).then(() => setStatus('saved'), () => setStatus('error'));
  };
  const update = (patch: Partial<BrandKit>): void => {
    const next = { ...kit, ...patch };
    setKit(next);
    setStatus('saving');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => save(next), 500);
  };
  /** Part of a section: `set('colors', { accent })`. */
  const set = <K extends keyof BrandKit>(key: K, patch: Partial<BrandKit[K]>): void => update({ [key]: { ...(kit[key] as object), ...patch } } as Partial<BrandKit>);
  const setFont = (role: 'heading' | 'body', patch: Partial<BrandFont>): void => set('fonts', { [role]: { ...kit.fonts[role], ...patch } });
  /** File changes are saved by the main process, with the rest of the form as it is now. */
  const files = (call: Promise<BrandKit>): void => {
    clearTimeout(timer.current);
    timer.current = undefined;
    void call.then((next) => (setKit(next), setStatus('saved')), failed);
  };
  const add = (slot: BrandSlot): void => files(api.addBrandFiles(kit, slot));
  /** Download a role's free font; `from` is the kit to start from (e.g. with a family just picked). */
  const fetchFont = async (role: 'heading' | 'body', from: BrandKit = latest.current): Promise<void> => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const next = await api.fetchFont(from, role);
    setKit(next);
    setStatus('saved');
  };
  const remove = (slot: BrandSlot, file?: string): void => files(api.removeBrandFile(kit, slot, file));
  /** Ask Claude. Whatever is waiting to be saved goes first, so Claude sees the form as it is. */
  const ask = async (text: string, files: string[] = []): Promise<void> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = undefined;
      await api.saveBrand(latest.current);
      setStatus('saved');
    }
    setChat((all) => [...all, { role: 'user', parts: [{ type: 'text', text }], ...(files.length ? { files } : {}) }, { role: 'assistant', parts: [] }]);
    setAsking(true);
    api.brandChatSend(kit.id, text, files).catch((e: Error) => {
      setChat((all) => foldEvent(all, { type: 'done', error: e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }));
      setAsking(false);
    });
  };
  const runExport = async (format: 'pdf' | 'md' | 'zip'): Promise<void> => {
    setExportMenu(false);
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = undefined;
      await api.saveBrand(latest.current);
      setStatus('saved');
    }
    setExportState({ busy: format === 'md' ? 'Exporting…' : 'Making the brand guidelines…' });
    try {
      const file = await api.exportBrand(latest.current, format);
      setExportState(file ? { file } : {});
    } catch (e) {
      setExportState({ error: (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') });
    }
  };
  const del = (): void => {
    if (!confirm(`Move the brand kit “${kit.name}” and its files to the Trash? Chats that use it go on without a brand kit.`)) return;
    clearTimeout(timer.current);
    timer.current = undefined;
    void api.deleteBrand(kit.id).then((kits) => (onChange(kits), onBack()), failed);
  };

  const logo = (slot: LogoSlot) => {
    const file = kit.logos[slot];
    return (
      <div className="logo-slot" key={slot}>
        <button type="button" className={slot === 'onDark' ? 'logo-tile dark' : 'logo-tile'} title={file ? `Replace ${file}` : 'Choose an image'} onClick={() => add(`logo:${slot}`)}>
          {file ? <img src={fileUrl(kit, file)} alt={LOGOS[slot]} /> : <Plus size={16} />}
        </button>
        <span className="label">{LOGOS[slot]}</span>
        {file && (
          <span className="logo-actions">
            <button type="button" className="ghost" title="Edit: background, crop, zoom, colour" aria-label={`Edit ${LOGOS[slot]}`} onClick={() => setEditing(slot)}><Pencil size={12} /></button>
            <button type="button" className="ghost" title="Remove" aria-label={`Remove ${LOGOS[slot]}`} onClick={() => remove(`logo:${slot}`)}><X size={12} /></button>
          </span>
        )}
      </div>
    );
  };
  const font = (role: 'heading' | 'body', label: string) => {
    const f = kit.fonts[role];
    return (
      <div className="fields">
        <Field label={label}>
          <input value={f.family} placeholder="Font family" onChange={(e) => setFont(role, { family: e.target.value })} />
        </Field>
        <Field label="Weight">
          <select value={f.weight} onChange={(e) => setFont(role, { weight: Number(e.target.value) })}>
            {WEIGHTS.map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
        </Field>
        <span className="file-pick">
          {f.file && !f.source ? (
            <span className="chip">{f.file} <button type="button" className="ghost" aria-label="Remove font file" onClick={() => remove(`font:${role}`)}><X size={12} /></button></span>
          ) : null}
          <button type="button" onClick={() => add(`font:${role}`)}>{f.file && !f.source ? 'Replace file…' : 'Upload font…'}</button>
        </span>
        <FontStatus
          font={f} onFetch={() => fetchFont(role)}
          onPick={(family) => fetchFont(role, { ...latest.current, fonts: { ...latest.current.fonts, [role]: { ...latest.current.fonts[role], family } } })}
        />
      </div>
    );
  };
  const audio = (slot: 'music' | 'sfx', list: string[]) => (
    <ul className="audio-list">
      {list.map((file) => (
        <li key={file}>
          {slot === 'music' ? <Music size={14} /> : <Volume2 size={14} />}
          <span className="grow">{file}</span>
          <audio src={fileUrl(kit, file)} controls preload="none" />
          <button type="button" className="ghost" title="Remove" aria-label={`Remove ${file}`} onClick={() => remove(slot, file)}><X size={14} /></button>
        </li>
      ))}
    </ul>
  );

  return (
    <div
      className="brand-editor"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const paths = [...e.dataTransfer.files].map((f) => api.pathForFile(f));
        if (paths.length) setDropped(paths);
      }}
    >
      <div className="row page-title">
        <button className="ghost" onClick={onBack}><ArrowLeft size={14} /> Brand kits</button>
        <span className="spacer" />
        <span className={status === 'error' ? 'note error' : 'note'}>{status === 'saving' ? 'Saving…' : status === 'error' ? 'Could not save' : 'Saved'}</span>
        {exportState.busy && <span className="note working">{exportState.busy}</span>}
        {exportState.error && <span className="note error export-error" title={exportState.error}>Export failed: {exportState.error}</span>}
        {exportState.file && (
          <span className="note">
            Exported <button className="ghost" onClick={() => void api.openExport(exportState.file!)}>Open</button>
            <button className="ghost" onClick={() => void api.openExport(exportState.file!, true)}>Show in Finder</button>
          </span>
        )}
        <span className="menu-wrap">
          <button className={exportMenu ? 'active' : ''} disabled={!!exportState.busy} aria-haspopup="menu" aria-expanded={exportMenu} onClick={() => setExportMenu(!exportMenu)}>
            <Download size={14} /> Export <ChevronDown size={12} />
          </button>
          {exportMenu && (
            <>
              <div className="backdrop" onClick={() => setExportMenu(false)} />
              <div className="menu" role="menu">
                <button role="menuitem" onClick={() => void runExport('pdf')}><FileText size={14} /><span><b>Brand guidelines (PDF)</b><small>A designed manual to send to clients, designers and editors</small></span></button>
                <button role="menuitem" onClick={() => void runExport('md')}><FileText size={14} /><span><b>Markdown</b><small>The same as text, for docs, wikis and AI tools; logos in a folder beside it</small></span></button>
                <button role="menuitem" onClick={() => void runExport('zip')}><Package size={14} /><span><b>Brand package (.zip)</b><small>Everything: the kit and its files, both documents and design tokens. Imports into Cutroom</small></span></button>
              </div>
            </>
          )}
        </span>
        <button className="ghost" title="Show in Finder" onClick={() => void api.revealBrand(kit.id)}><FolderOpen size={14} /></button>
        <button className="ghost" title="Move to Trash" onClick={del}><Trash2 size={14} /></button>
      </div>
      <input className="brand-name" value={kit.name} aria-label="Name of the brand kit" onChange={(e) => update({ name: e.target.value })} />
      <div className="brand-columns">
        <form className="settings brand-form" onSubmit={(e) => e.preventDefault()}>
          <section>
            <h2>About</h2>
            <textarea
              rows={2} value={kit.about} aria-label="About the brand"
              placeholder="Who the brand is, for whom, how it feels — one or two sentences. It opens the brand guidelines and tells Claude the spirit."
              onChange={(e) => update({ about: e.target.value })}
            />
          </section>

          <section>
            <h2>Logo</h2>
            <div className="logos">{(['main', 'mark', 'onDark'] as const).map(logo)}</div>
            <div className="fields">
              <button type="button" onClick={() => setStudio(true)}>
                <PenTool size={14} /> Logo studio
              </button>
              <span className="hint grow">
                Claude redraws your logo as a clean vector, or designs a new one with you. The pencil on a logo removes a background,
                crops, zooms and recolours.
              </span>
            </div>
            <label className="choice"><input type="checkbox" checked={kit.watermark.on} onChange={(e) => set('watermark', { on: e.target.checked })} /> Watermark through the whole video</label>
            {kit.watermark.on && (
              <div className="fields">
                <Field label="Logo"><Pick value={kit.watermark.logo} options={LOGOS} onChange={(logo) => set('watermark', { logo })} /></Field>
                <Field label={`Opacity · ${Math.round(kit.watermark.opacity * 100)}%`}>
                  <input type="range" min={0.2} max={1} step={0.05} value={kit.watermark.opacity} onChange={(e) => set('watermark', { opacity: Number(e.target.value) })} />
                </Field>
              </div>
            )}
            {!kit.watermark.on || kit.logos[kit.watermark.logo] ? null : <p className="note error">Add the {LOGOS[kit.watermark.logo].toLowerCase()} for the watermark.</p>}
            <label className="choice"><input type="checkbox" checked={kit.endCard.on} onChange={(e) => set('endCard', { on: e.target.checked })} /> End card with the logo</label>
            {kit.endCard.on && (
              <Field label="Line under the logo">
                <input value={kit.endCard.line} placeholder="acme.com · Link in bio" onChange={(e) => set('endCard', { line: e.target.value })} />
              </Field>
            )}
            <div className="fields">
              <Field label="Handle"><input value={kit.identity.handle} placeholder="@acme" onChange={(e) => set('identity', { handle: e.target.value })} /></Field>
              <Field label="Website"><input value={kit.identity.website} placeholder="acme.com" onChange={(e) => set('identity', { website: e.target.value })} /></Field>
            </div>
          </section>

          <section>
            <h2>Layout</h2>
            <p className="hint">
              Where titles, subtitles, captions, the logo and your handle sit, and how they look — with TikTok’s, Instagram’s and
              YouTube’s buttons drawn on top, so nothing ends up under them.
            </p>
            <button type="button" onClick={() => setLayoutStudio(true)}><LayoutTemplate size={14} /> Open the layout studio</button>
          </section>

          <section>
            <h2>Colours</h2>
            <div className="colors">
              {(Object.entries({ primary: 'Primary', secondary: 'Secondary', accent: 'Accent', text: 'Text', background: 'Background' }) as [keyof BrandKit['colors'], string][]).map(([key, label]) => (
                <label key={key} className="color">
                  <input type="color" value={kit.colors[key]} aria-label={label} onChange={(e) => set('colors', { [key]: e.target.value })} />
                  <span className="label">{label}</span>
                  <input
                    className="hex" key={kit.colors[key]} defaultValue={kit.colors[key]} aria-label={`${label} hex`} spellCheck={false}
                    onBlur={(e) => {
                      const hex = e.target.value.trim().replace(/^#?/, '#').toLowerCase();
                      if (/^#[0-9a-f]{6}$/.test(hex) && hex !== kit.colors[key]) set('colors', { [key]: hex });
                      else e.target.value = kit.colors[key];
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), e.currentTarget.blur())}
                  />
                </label>
              ))}
            </div>
            <p className="hint">The accent marks the word being said in captions, and other highlights.</p>
          </section>

          <section>
            <h2>Typography</h2>
            {font('heading', 'Headings and titles')}
            {font('body', 'Captions and body text')}
            <p className="hint">Free fonts (Google Fonts and other open-licensed families) download into the kit. For a paid font, upload the file.</p>
          </section>

          <section>
            <h2>Captions</h2>
            <div className="fields">
              <Field label="When">
                <Pick value={kit.captions.mode} options={{ speech: 'When someone talks', always: 'Always', off: 'Never' }} onChange={(mode) => set('captions', { mode })} />
              </Field>
              <Field label="Letters">
                <Pick value={kit.captions.case} options={{ 'as-spoken': 'As spoken', upper: 'UPPERCASE', lower: 'lowercase' }} onChange={(c) => set('captions', { case: c })} />
              </Field>
              <Field label="Words at a time">
                <input type="number" min={1} max={12} value={kit.captions.words} onChange={(e) => set('captions', { words: Math.max(1, Math.min(12, Number(e.target.value) || 1)) })} />
              </Field>
            </div>
            <div className="fields">
              <label className="choice"><input type="checkbox" checked={kit.captions.highlight} onChange={(e) => set('captions', { highlight: e.target.checked })} /> Highlight the word being said</label>
              <label className="choice"><input type="checkbox" checked={kit.captions.outline} onChange={(e) => set('captions', { outline: e.target.checked })} /> Outline</label>
              <label className="choice"><input type="checkbox" checked={kit.captions.shadow} onChange={(e) => set('captions', { shadow: e.target.checked })} /> Shadow</label>
            </div>
          </section>

          <section>
            <h2>Music</h2>
            {audio('music', kit.music.tracks)}
            <button type="button" onClick={() => add('music')}><Plus size={14} /> Add tracks…</button>
            <div className="fields">
              <Field label="Mood" hint={kit.music.tracks.length ? 'Claude picks the track that fits each video.' : 'Without tracks, Claude finds or generates music in this mood.'}>
                <input value={kit.music.mood} placeholder="warm, upbeat acoustic" onChange={(e) => set('music', { mood: e.target.value })} />
              </Field>
              <Field label={`Under speech · ${Math.round(kit.music.level * 100)}%`}>
                <input type="range" min={0} max={0.5} step={0.01} value={kit.music.level} onChange={(e) => set('music', { level: Number(e.target.value) })} />
              </Field>
            </div>
          </section>

          <section>
            <h2>Sound effects</h2>
            <Field label="How many">
              <Pick value={kit.sfx.amount} options={{ none: 'None', subtle: 'A few, on key moments', lots: 'Lots: cuts, titles, pop-ups' }} onChange={(amount) => set('sfx', { amount })} />
            </Field>
            {audio('sfx', kit.sfx.files)}
            <button type="button" onClick={() => add('sfx')}><Plus size={14} /> Add your own sounds…</button>
          </section>

          <section>
            <h2>Look and motion</h2>
            <div className="fields">
              <Field label="Transitions">
                <Pick value={kit.look.transitions} options={{ cuts: 'Hard cuts', crossfades: 'Crossfades', whips: 'Whips and pushes', mixed: 'Mixed' }} onChange={(transitions) => set('look', { transitions })} />
              </Field>
              <Field label="Energy">
                <Pick value={kit.look.energy} options={{ calm: 'Calm', balanced: 'Balanced', punchy: 'Punchy' }} onChange={(energy) => set('look', { energy })} />
              </Field>
              <span className="file-pick">
                {kit.look.lut && <span className="chip">{kit.look.lut} <button type="button" className="ghost" aria-label="Remove LUT" onClick={() => remove('lut')}><X size={12} /></button></span>}
                <button type="button" onClick={() => add('lut')}>{kit.look.lut ? 'Replace LUT…' : 'Colour LUT (.cube)…'}</button>
              </span>
            </div>
          </section>

          <section>
            <h2>Voice and words</h2>
            <div className="fields">
              <Field label="Voice-over" hint={voices?.length === 0 ? 'Connect ElevenLabs in Settings to pick a voice.' : undefined}>
                <select
                  value={kit.voice?.id ?? ''} disabled={!voices?.length && !kit.voice}
                  onChange={(e) => update({ voice: voices?.find((v) => v.id === e.target.value) })}
                >
                  <option value="">No preference</option>
                  {kit.voice && !voices?.some((v) => v.id === kit.voice!.id) && <option value={kit.voice.id}>{kit.voice.name}</option>}
                  {voices?.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </Field>
              <Field label="Language"><input value={kit.copy.language} placeholder="Same as the footage" onChange={(e) => set('copy', { language: e.target.value })} /></Field>
            </div>
            <div className="fields">
              <Field label="Tone"><input value={kit.copy.tone} placeholder="friendly, direct, a little dry" onChange={(e) => set('copy', { tone: e.target.value })} /></Field>
              <Field label="Never say"><input value={kit.copy.avoid} placeholder="cheap, revolutionary" onChange={(e) => set('copy', { avoid: e.target.value })} /></Field>
            </div>
            <label className="choice"><input type="checkbox" checked={kit.copy.emoji} onChange={(e) => set('copy', { emoji: e.target.checked })} /> Emoji in text on screen</label>
          </section>

          <section>
            <h2>Format</h2>
            <div className="fields">
              <Field label="Frame">
                <Pick value={kit.format.aspect} options={{ '': 'Whatever suits the footage', '9:16': '9:16 vertical', '16:9': '16:9 landscape', '1:1': '1:1 square', '4:5': '4:5 portrait' }} onChange={(aspect) => set('format', { aspect })} />
              </Field>
              <Field label="Length (seconds)" hint="0 = any">
                <input type="number" min={0} max={600} value={kit.format.length} onChange={(e) => set('format', { length: Math.max(0, Number(e.target.value) || 0) })} />
              </Field>
            </div>
          </section>

          <section>
            <h2>Notes</h2>
            <textarea rows={4} value={kit.notes} placeholder="Anything else Claude should know: “product always shown on white”, “never show competitors’ logos”…" onChange={(e) => update({ notes: e.target.value })} />
          </section>
        </form>
        <aside className="brand-side">
          <BrandPreview kit={kit} onLayout={() => setLayoutStudio(true)} />
          <p className="hint">Pick this kit with the brand menu at the top of any chat. Changes here reach chats that use it with their next message.</p>
        </aside>
      </div>
      {layoutStudio && <LayoutStudio kit={kit} update={update} onClose={() => setLayoutStudio(false)} />}
      {studio && (
        <LogoStudio
          kit={kit} onClose={() => setStudio(false)}
          onKit={(next) => (clearTimeout(timer.current), (timer.current = undefined), setKit(next), setStatus('saved'))}
        />
      )}
      {editing && (
        <LogoEditor
          kit={kit} slot={editing} onClose={() => setEditing('')}
          onSaved={(next) => (clearTimeout(timer.current), (timer.current = undefined), setKit(next), setStatus('saved'))}
        />
      )}
      <ClaudeBubble
        title={`Claude · ${kit.name}`} messages={chat} busy={asking} open={chatOpen} setOpen={setChatOpen}
        onSend={(text, files) => void ask(text, files)} onStop={() => void api.brandChatStop()}
        onAttach={(paths) => api.brandChatAttach(kit.id, paths)} dropped={dropped} onDropped={() => setDropped([])}
        attachedText="Take everything you can from this for the brand kit." 
        onReset={() => void api.brandChatReset(kit.id).then(() => setChat([]), failed)}
        placeholder="Your website, or what the brand is like…"
        intro={
          <p className="hint">
            Give Claude your website, attach your brand guidelines (PDF) or a video in your style — or drop them anywhere on this
            page — and watch it fill in the kit: colours, fonts, logo, captions and sound. Then ask for changes: “warmer colours”,
            “captions in capitals”, “calmer music”.
          </p>
        }
        suggestions={['Fill it in from our website: ', 'Take the style from this video: ', 'Make it feel more premium']}
      />
    </div>
  );
}

/** Home › Brand kits: the look and sound of each brand, for any chat to use. */
export function Brands() {
  const [kits, setKits] = useState<BrandKit[] | null>(null);
  const [open, setOpen] = useState<{ kit: BrandKit; fresh?: boolean } | null>(null);
  const reload = (next?: BrandKit[]): void => void (next ? setKits(next) : api.listBrands().then(setKits));
  useEffect(() => reload(), []);
  const create = (): void => void api.createBrand('New brand kit').then((kit) => (setOpen({ kit, fresh: true }), reload()), failed);
  const importKit = (file?: string): void =>
    void api.importBrand(file).then((kit) => kit && (setOpen({ kit }), reload()), failed);

  if (open) return <BrandEditor key={open.kit.id} initial={open.kit} fresh={open.fresh} onBack={() => (setOpen(null), reload())} onChange={reload} />;
  return (
    <div
      className="brands-page"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const file = [...e.dataTransfer.files].map((f) => api.pathForFile(f)).find((f) => /\.zip$|brand\.json$/i.test(f));
        if (file) importKit(file);
      }}
    >
      <div className="row page-title">
        <h1>Brand kits</h1>
        <span className="spacer" />
        <button title="A brand package (.zip) exported from Cutroom — or drop it here" onClick={() => importKit()}><Upload size={14} /> Import</button>
        <button className="primary" onClick={create}><Plus size={14} /> New brand kit</button>
      </div>
      <p className="hint">
        A brand kit is how your videos look and sound: logo, colours, fonts, captions, music and sound effects. Pick one per chat with the
        brand menu at the top of the chat, and change it any time. Split a chat to make the same video for another brand. A style says how a
        video is cut; the brand kit says what it looks like.
      </p>
      {kits && kits.length === 0 && (
        <p className="hint">No brand kits yet. Make one here, and Claude fills it in from your website, or ask in a project chat to save the look of an edit as a brand kit.</p>
      )}
      <ul className="brand-cards">
        {kits?.map((kit) => {
          const logo = kit.logos.main ?? kit.logos.mark ?? kit.logos.onDark;
          return (
            <li key={kit.id}>
              <button className="ghost" onClick={() => setOpen({ kit })}>
                <span className="swatch" style={{ background: kit.colors.background }}>
                  {logo ? <img src={fileUrl(kit, logo)} alt="" /> : <strong style={{ color: kit.colors.text }}>{kit.name.slice(0, 1)}</strong>}
                </span>
                <span className="grow">
                  <strong>{kit.name}</strong>
                  <span className="colors-row">
                    {Object.values(kit.colors).map((color, i) => <i key={i} style={{ background: color }} />)}
                  </span>
                  <span className="description">{kit.fonts.heading.family}{kit.fonts.body.family !== kit.fonts.heading.family ? ` · ${kit.fonts.body.family}` : ''}{kit.music.tracks.length ? ` · ${kit.music.tracks.length} track${kit.music.tracks.length > 1 ? 's' : ''}` : ''}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
