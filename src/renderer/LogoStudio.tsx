import { useEffect, useState } from 'react';
import { Check, RotateCcw, Sparkles, X } from 'lucide-react';
import type { BrandKit, LogoSlot } from '../shared/brand';
import type { ChatMessage, LogoDraft } from '../shared/types';
import { ChatPanel, foldEvent } from './ClaudeBubble';
import { api, failed } from './lib';

const SLOTS: Record<LogoSlot, string> = { main: 'Full logo', mark: 'Icon', onDark: 'For dark backgrounds' };
const VIEWS = { checker: 'Transparent', light: 'Light', dark: 'Dark', brand: 'Brand colour' } as const;
const svgUrl = (svg: string): string => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/**
 * The logo studio: Claude draws the kit's logo as SVG — a clean vector redraw of the one there is, or a new design —
 * and every version appears here. Pick one and put it into the kit, or keep talking.
 */
export function LogoStudio({ kit, onKit, onClose }: { kit: BrandKit; onKit: (kit: BrandKit) => void; onClose: () => void }) {
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<LogoDraft[]>([]);
  /** The version on show: the newest unless the user picked another. */
  const [shown, setShown] = useState<number | null>(null);
  const [view, setView] = useState<keyof typeof VIEWS>('checker');
  const [saved, setSaved] = useState('');

  useEffect(() => {
    void api.logoChat(kit.id).then(setChat);
    void api.logoDrafts(kit.id).then(setDrafts);
    const off = [
      api.on('logo-agent', ({ kit: id, event }) => {
        if (id !== kit.id) return;
        setChat((all) => foldEvent(all, event));
        if (event.type === 'done') setBusy(false);
      }),
      api.on('logo-draft', ({ kit: id, draft }) => {
        if (id !== kit.id) return;
        setDrafts((all) => [...all.filter((d) => d.version !== draft.version), draft]);
        setShown(null); // follow the newest
      }),
    ];
    const onKey = (e: KeyboardEvent): void => void (e.key === 'Escape' && !busy && onClose());
    window.addEventListener('keydown', onKey);
    return () => (off.forEach((stop) => stop()), window.removeEventListener('keydown', onKey));
  }, [kit.id]);

  const draft = drafts.find((d) => d.version === shown) ?? drafts.at(-1);
  const send = (text: string, files: string[]): void => {
    setChat((all) => [...all, { role: 'user', parts: [{ type: 'text', text }], ...(files.length ? { files } : {}) }, { role: 'assistant', parts: [] }]);
    setBusy(true);
    api.logoChatSend(kit.id, text, files).catch((e: Error) => {
      setChat((all) => foldEvent(all, { type: 'done', error: e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }));
      setBusy(false);
    });
  };
  const use = (slot: LogoSlot): void => {
    if (!draft) return;
    if (kit.logos[slot] && !confirm(`Replace the kit's ${SLOTS[slot].toLowerCase()} with version ${draft.version}? The old file goes to the Trash.`)) return;
    void api.useLogoDraft(kit.id, draft.version, slot).then((next) => (onKit(next), setSaved(`Version ${draft.version} is now the ${SLOTS[slot].toLowerCase()}.`)), failed);
  };
  const backdrop = view === 'brand' ? kit.colors.primary : view === 'dark' ? '#141414' : view === 'light' ? '#ffffff' : undefined;
  const has = Object.keys(kit.logos).length > 0;

  return (
    <div className="modal" onPointerDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <section className="logo-studio" role="dialog" aria-label="Logo studio">
        <header>
          <Sparkles size={16} />
          <h2>Logo studio</h2>
          <span className="note">{kit.name}</span>
          <span className="spacer" />
          <div className="switch" role="tablist" aria-label="Background">
            {(Object.keys(VIEWS) as (keyof typeof VIEWS)[]).map((v) => (
              <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}>{VIEWS[v]}</button>
            ))}
          </div>
          <button className="ghost round" aria-label="Close" title={busy ? 'Claude is still working: it goes on, and you can come back' : 'Close'} onClick={onClose}><X size={16} /></button>
        </header>
        <div className="studio-body">
          <div className="studio-canvas">
            <div className={`studio-stage${view === 'checker' ? ' checker' : ''}`} style={{ background: backdrop }}>
              {draft ? <img src={svgUrl(draft.svg)} alt={`Version ${draft.version}`} /> : (
                <p className="hint">
                  {has ? 'Ask Claude to redraw your logo as a clean vector, or to design a new one.' : 'Describe the logo you want, or attach a sketch — Claude draws it here.'}
                </p>
              )}
            </div>
            {draft && (
              <div className="studio-actions">
                <span className="grow"><strong>v{draft.version}</strong> <span className="note">{draft.note}</span></span>
                {saved ? <span className="note ok"><Check size={12} /> {saved}</span> : <span className="note">Use as</span>}
                {(Object.keys(SLOTS) as LogoSlot[]).map((slot) => (
                  <button key={slot} disabled={busy} title={kit.logos[slot] ? `Replaces the kit's ${SLOTS[slot].toLowerCase()}` : undefined} onClick={() => (setSaved(''), use(slot))}>{SLOTS[slot]}</button>
                ))}
              </div>
            )}
            {drafts.length > 0 && (
              <div className="versions-strip" role="listbox" aria-label="Versions">
                {drafts.map((d) => (
                  <button key={d.version} role="option" aria-selected={d.version === draft?.version} title={d.note} onClick={() => (setShown(d.version), setSaved(''))}>
                    <img src={svgUrl(d.svg)} alt="" />
                    <span>v{d.version}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="studio-chat">
            <div className="row">
              <strong>Claude</strong>
              <span className="spacer" />
              <button className="ghost round" title="New conversation (the versions stay)" aria-label="New conversation" disabled={busy || !chat.length} onClick={() => void api.logoChatReset(kit.id).then(() => setChat([]), failed)}><RotateCcw size={14} /></button>
            </div>
            <ChatPanel
              messages={chat} busy={busy} onSend={send} onStop={() => void api.logoChatStop()}
              onAttach={(paths) => api.logoChatAttach(kit.id, paths)}
              attachTitle="Attach a logo, a sketch or brand guidelines (PDF) — or drop them here"
              attachedText="Redraw this as a clean vector logo."
              placeholder="Tell Claude what to draw or change…"
              intro={
                <p className="hint">
                  Claude draws your logo as a vector (SVG): sharp at every size, light enough for video. It looks at every version
                  itself before showing you. Ask for changes in your own words — “thinner lines”, “more space between the letters”,
                  “try it in the accent colour”.
                </p>
              }
              suggestions={has
                ? ['Redraw our full logo as a clean vector', 'Make a white version for dark backgrounds', 'Make the icon simpler and bolder for small sizes', 'Design three new directions for the logo']
                : ['Design a logo for this brand: three different directions', 'A minimal monogram with our initials', 'A wordmark in our heading font']}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
