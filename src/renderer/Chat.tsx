import { memo, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { ArrowUp, Film, Flag, GitBranch, Library, Palette, Sparkles, Square, Star, TriangleAlert, Undo2, X } from 'lucide-react';
import type { BrandKit } from '../shared/brand';
import { EMPTY_TIMELINE } from '../shared/types';
import type { AgentEvent, ChatMessage, Cuts, Mark, MediaFile, ModelChoice, Skill, Timeline } from '../shared/types';
import { CutTabs } from './CutTabs';
import { useLibraryFilter } from './LibraryFilter';
import { Markdown } from './Markdown';
import { Settings } from './Settings';
import { api, clock, failed } from './lib';

interface Props {
  /** The project's chats; this one shows `cuts.active`. */
  cuts: Cuts;
  onCuts: (cuts: Cuts) => void;
  timeline: Timeline | null;
  /** Put an earlier version of the edit back (undoable, like any manual edit). */
  onRestore: (timeline: Timeline) => void;
  marks: Mark[];
  setMarks: (marks: Mark[]) => void;
  media: MediaFile[];
  /** Lets the rest of the app send a message, e.g. the script's Approve button. */
  sender: RefObject<((text: string) => void) | null>;
}

const markLabel = (mark: Mark): string =>
  mark.itemId ?? (mark.end ? `${clock(mark.start)} – ${clock(mark.end)}` : clock(mark.start));

const fileName = (path: string): string => path.split('/').pop()!;

/** Fold one streamed agent event into the conversation. */
function reduce(messages: ChatMessage[], event: AgentEvent): ChatMessage[] {
  const last = messages.at(-1);
  if (last?.role !== 'assistant') return messages;
  const parts = [...last.parts];
  const tail = parts.at(-1);
  if (event.type === 'text' && tail?.type === 'text') parts[parts.length - 1] = { type: 'text', text: tail.text + event.text };
  else if (event.type !== 'done') parts.push(event);
  else if (event.error) parts.push({ type: 'text', text: event.error });
  const done = event.type === 'done' ? { error: !!event.error, uuid: event.uuid } : {};
  return [...messages.slice(0, -1), { ...last, parts, ...done }];
}

/** The conversation with Claude. Marks made in the preview or timeline ride along with the next message. */
export const Chat = memo(function Chat({ cuts, onCuts, timeline, onRestore, marks, setMarks, media, sender }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  /** Styles and moves picked for the next message (skill ids). */
  const [picked, setPicked] = useState<string[]>([]);
  const [model, setModel] = useState<ModelChoice | null>(null);
  const [brands, setBrands] = useState<BrandKit[]>([]);
  /** The brand kit was changed on a chat that already has an edit: offer to restyle it now. */
  const [rebranded, setRebranded] = useState('');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<string[]>([]);
  const [picking, setPicking] = useState<'' | 'footage' | 'library'>('');
  /** A chat whose name is being edited: one just made or split off. */
  const [renaming, setRenaming] = useState('');
  /** A message that was held back because no model is connected. */
  const [warning, setWarning] = useState<{ text: string; alternatives: boolean } | null>(null);
  /** Settings, opened from that warning. */
  const [connecting, setConnecting] = useState(false);
  /** Whether a model is known to be connected, and whether that is being looked up. */
  const brain = useRef({ ready: false, checking: false });
  const [listed, filter] = useLibraryFilter(skills);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  // Each chat has its own conversation; a fresh one starts with an empty composer.
  useEffect(() => {
    void api.loadChat().then(setMessages);
    setDraft('');
    setFiles([]);
    setPicked([]);
    setPicking('');
    setWarning(null);
    setRebranded('');
  }, [cuts.active]);
  useEffect(() => {
    void api.listSkills().then(setSkills);
    void api.getModel().then(setModel);
    void api.listBrands().then(setBrands);
    return api.on('agent', (event) => {
      setMessages((all) => reduce(all, event));
      if (event.type === 'done') {
        setBusy(false);
        void api.listSkills().then(setSkills); // the turn may have saved a new style
        void api.listBrands().then(setBrands); // …or a brand kit
      }
    });
  }, []);
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [messages]);
  // Persist the conversation whenever a turn finishes.
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !busy) void api.saveChat(messages);
    wasBusy.current = busy;
  }, [busy, messages]);

  /** Send a message. Without a connected model it is held back with a warning, unless the user sends it `anyway`. */
  const sendText = async (text: string, anyway = false): Promise<boolean> => {
    if (!text || busy || brain.current.checking) return false;
    if (!brain.current.ready && !anyway) {
      brain.current.checking = true;
      const found = await api.brain().finally(() => (brain.current.checking = false));
      brain.current.ready = found.ready;
      if (!found.ready) return setWarning({ text, alternatives: found.alternatives }), false;
    }
    setWarning(null);
    setRebranded('');
    setMessages((all) => [...all, { role: 'user', parts: [{ type: 'text', text }], marks, files, skills: picked }, { role: 'assistant', parts: [], before: timeline ?? EMPTY_TIMELINE }]);
    setBusy(true);
    void api.send(text, marks, files, picked);
    setMarks([]);
    setFiles([]);
    setPicking('');
    setPicked([]);
    return true;
  };
  sender.current = (text) => void sendText(text);
  const send = (): void => void sendText(draft.trim()).then((sent) => sent && setDraft(''));
  /** Settings were closed: the held-back message can go once a model is connected. */
  const connected = (): void => {
    setConnecting(false);
    void api.getModel().then(setModel);
    void api.brain().then((found) => (brain.current.ready = found.ready) && setWarning(null));
  };
  const hasEdit = !!timeline?.clips.length;
  /** The edit as it was before reply `i`, if that reply (Claude's step) changed it. */
  const stepBack = (i: number): Timeline | undefined => {
    const before = messages[i]!.before;
    const after = messages.slice(i + 1).find((m) => m.before)?.before ?? timeline ?? EMPTY_TIMELINE;
    return before && JSON.stringify(before) !== JSON.stringify(after) ? before : undefined;
  };
  /** Branch this chat after reply `i` into a new one, e.g. to make the same video with subtitles in another language. */
  const split = (i: number): void => {
    const name = cuts.cuts.find((c) => c.id === cuts.active)?.name ?? 'Chat';
    void api.splitCut(i, `${name} 2`).then((next) => (onCuts(next), setRenaming(next.active)), failed);
  };
  const toggleFile = (path: string): void => setFiles(files.includes(path) ? files.filter((f) => f !== path) : [...files, path]);
  const togglePick = (id: string): void => setPicked(picked.includes(id) ? picked.filter((p) => p !== id) : [...picked, id]);
  const nameOf = (id: string): string => skills.find((s) => s.id === id)?.name ?? id;
  /** Put "@name" where the cursor is, so the message can say where a move goes. */
  const mention = (id: string): void => {
    const el = input.current!;
    const word = `@${nameOf(id)} `;
    setDraft(draft.slice(0, el.selectionStart) + word + draft.slice(el.selectionEnd));
    el.focus();
  };
  const footage = media.filter((file) => file.dir === 'raw' && file.kind === 'video');
  const brandId = cuts.cuts.find((c) => c.id === cuts.active)?.brand ?? '';
  const brand = brands.find((b) => b.id === brandId);
  const pickBrand = (id: string): void => {
    if (id === '__save') {
      setDraft('Save the look of this edit as a brand kit called ');
      input.current?.focus();
      return;
    }
    void api.setCutBrand(id).then((next) => {
      onCuts(next);
      setRebranded(id && hasEdit ? brands.find((b) => b.id === id)?.name ?? '' : '');
    }, failed);
  };
  const saveStyle = (): void => {
    setDraft('Save the style of this edit, and its moves, to my library. Call the style ');
    input.current?.focus();
  };

  return (
    <section className="chat">
      <div className="chat-top">
        <CutTabs cuts={cuts} onCuts={onCuts} busy={busy} renaming={renaming} setRenaming={setRenaming} />
        <label className={brand ? 'brand-select set' : 'brand-select'} title={busy ? 'Wait until Claude has finished' : 'Brand kit of this chat: logo, colours, fonts and sound. Make kits in Home › Brand kits.'}>
          <Palette size={14} />
          <select value={brand ? brandId : ''} disabled={busy} aria-label="Brand kit of this chat" onChange={(e) => pickBrand(e.target.value)}>
            <option value="">No brand kit</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            <option value="__save" disabled={!hasEdit}>Save this edit’s look as a brand kit…</option>
          </select>
        </label>
      </div>
      <div className="messages" ref={list}>
        {messages.length === 0 && (
          <p className="hint">
            Describe the video you want — “make a 30 second reel from the best moments”. Paste links to videos you like
            as references. Then mark frames or sections in the preview and say what to change. Pick a brand kit at the top
            right to set the logo, colours, fonts and sound for this chat.
          </p>
        )}
        {messages.map((message, i) => (
          <article key={i} className={`${message.role}${message.error ? ' error' : ''}`}>
            {message.marks?.map((mark, n) => (
              <span key={n} className="chip"><Flag size={12} /> {markLabel(mark)}</span>
            ))}
            {message.files?.map((file) => (
              <span key={file} className="chip file"><Film size={12} /> {fileName(file)}</span>
            ))}
            {message.skills?.map((id) => (
              <span key={id} className="chip skill"><Sparkles size={12} /> {nameOf(id)}</span>
            ))}
            {message.parts.map((part, n) =>
              part.type === 'tool' ? <p key={n} className="tool">{part.text}</p> : <Markdown key={n} text={part.text} />,
            )}
            {busy && i === messages.length - 1 ? <p className="tool working">Working…</p> : message.role === 'assistant' && (
              <div className="reply-actions">
                {stepBack(i) && (
                  <button className="ghost back" title="Put the edit back to how it was before this step" onClick={() => onRestore(stepBack(i)!)}>
                    <Undo2 size={14} /> Go back to before this
                  </button>
                )}
                <button className="ghost back" disabled={busy} title="Continue from here in a new chat with its own copy of the edit — for another language, length or platform. This chat stays as it is." onClick={() => split(i)}>
                  <GitBranch size={14} /> Split from here
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
      {warning && (
        <div className="warning" role="alert">
          <p>
            <TriangleAlert size={14} /> <strong>No model is connected.</strong>{' '}
            {warning.alternatives
              ? 'This chat is set to a Claude model, but Claude is not connected. Connect Claude, or choose one of your other models below.'
              : 'Connect Claude or another provider so the editor can answer. Your message is kept.'}
          </p>
          <div className="row">
            <button type="button" className="primary" onClick={() => setConnecting(true)}>Connect now</button>
            <button
              type="button" className="ghost" title="Try it with what is set up on this Mac"
              onClick={() => void sendText(warning.text, true).then((sent) => sent && draft.trim() === warning.text && setDraft(''))}
            >
              Send anyway
            </button>
            <span className="spacer" />
            <button type="button" className="ghost round" title="Dismiss" onClick={() => setWarning(null)}><X size={14} /></button>
          </div>
        </div>
      )}
      {rebranded && !busy && (
        <div className="warning info" role="status">
          <p><Palette size={14} /> This chat now uses <strong>{rebranded}</strong>. Claude restyles the edit with your next message.</p>
          <div className="row">
            <button type="button" className="primary" onClick={() => void sendText(`Restyle this edit with the ${rebranded} brand kit.`)}>Restyle now</button>
            <span className="spacer" />
            <button type="button" className="ghost round" title="Dismiss" onClick={() => setRebranded('')}><X size={14} /></button>
          </div>
        </div>
      )}
      {connecting && (
        <div className="modal">
          <section role="dialog" aria-label="Settings">
            <div className="body">
              <Settings><button type="button" onClick={connected}>Close</button></Settings>
            </div>
          </section>
        </div>
      )}
      <form className="composer" onSubmit={(e) => (e.preventDefault(), send())}>
        {picking === 'footage' && (
          <div className="footage">
            {footage.map((file) => (
              <button type="button" key={file.path} className={files.includes(file.path) ? 'selected' : ''} title={fileName(file.path)} onClick={() => toggleFile(file.path)}>
                <video src={`media://project/${encodeURI(file.path)}#t=0.5`} preload="metadata" muted />
                <span>{fileName(file.path)}</span>
              </button>
            ))}
            {footage.length === 0 && <p className="hint">No footage in raw/ yet. Drop videos onto the window.</p>}
          </div>
        )}
        {picking === 'library' && (
          <div className="library-pick">
            {filter}
            <ul>
              {listed.map((s) => (
                <li key={s.id}>
                  <button type="button" className={picked.includes(s.id) ? 'selected' : ''} title={s.description} onClick={() => togglePick(s.id)}>
                    {s.favorite && <Star size={12} className="favorite" />}
                    <strong>{s.name}</strong> <span className="tag">{s.kind === 'move' ? 'Move' : 'Style'}</span>
                    <span className="description">{s.description}</span>
                  </button>
                </li>
              ))}
              {listed.length === 0 && <li className="hint">Nothing matches.</li>}
            </ul>
          </div>
        )}
        {marks.length + files.length + picked.length > 0 && (
          <div className="chips">
            {picked.map((id) => (
              <span key={id} className="chip skill">
                <button type="button" title="Mention it in your message, to say where it goes" onClick={() => mention(id)}><Sparkles size={12} /> @{nameOf(id)}</button>
                <button type="button" title="Remove" aria-label={`Remove ${nameOf(id)}`} onClick={() => togglePick(id)}><X size={12} /></button>
              </span>
            ))}
            {files.map((file) => (
              <button type="button" key={file} className="chip file" title="Remove" onClick={() => toggleFile(file)}>
                <Film size={12} /> {fileName(file)} <X size={12} />
              </button>
            ))}
            {marks.map((mark, i) => (
              <button type="button" key={i} className="chip" title="Remove mark" onClick={() => setMarks(marks.filter((m) => m !== mark))}>
                <Flag size={12} /> {markLabel(mark)} <X size={12} />
              </button>
            ))}
          </div>
        )}
        <textarea
          ref={input} rows={3} value={draft} autoFocus
          placeholder={marks.length ? 'What should change at the marked spots?' : 'Tell Claude what to make or change…'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}
        />
        <div className="row">
          <button type="button" className={picking === 'footage' ? 'active' : 'ghost'} title="Choose the footage Claude should use" onClick={() => setPicking(picking === 'footage' ? '' : 'footage')}>
            <Film size={14} /> Footage
          </button>
          <button type="button" className={picking === 'library' ? 'active' : 'ghost'} title="Choose styles and moves from your library; click a chosen one to mention it in your message" onClick={() => setPicking(picking === 'library' ? '' : 'library')}>
            <Library size={14} /> Styles &amp; moves
          </button>
          {model && (
            <select
              value={model.project} aria-label="Model" title="Model for this project"
              onChange={(e) => (setModel({ ...model, project: e.target.value }), void api.setProjectModel(e.target.value))}
            >
              <option value="">Model: {model.options.find((o) => o.id === model.default)?.label}</option>
              {model.options.filter((o) => o.id).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          )}
          <button type="button" className="ghost" disabled={!hasEdit || busy} title="Save style: keep this look for future videos" aria-label="Save style" onClick={saveStyle}>
            <Sparkles size={14} />
          </button>
          <span className="spacer" />
          {busy ? (
            <button type="button" className="primary round" aria-label="Stop" onClick={() => void api.stop()}><Square size={14} /></button>
          ) : (
            <button type="submit" className="primary round" aria-label="Send" disabled={!draft.trim()}><ArrowUp size={16} /></button>
          )}
        </div>
      </form>
    </section>
  );
});
