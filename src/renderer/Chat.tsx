import { memo, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { ArrowUp, Film, Flag, Library, Sparkles, Square, Star, Undo2, X } from 'lucide-react';
import { EMPTY_TIMELINE } from '../shared/types';
import type { AgentEvent, ChatMessage, Mark, MediaFile, ModelChoice, Skill, Timeline } from '../shared/types';
import { useLibraryFilter } from './LibraryFilter';
import { Markdown } from './Markdown';
import { api, clock } from './lib';

interface Props {
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
  return [...messages.slice(0, -1), { ...last, parts, error: event.type === 'done' && !!event.error }];
}

/** The conversation with Claude. Marks made in the preview or timeline ride along with the next message. */
export const Chat = memo(function Chat({ timeline, onRestore, marks, setMarks, media, sender }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  /** Styles and moves picked for the next message (skill ids). */
  const [picked, setPicked] = useState<string[]>([]);
  const [model, setModel] = useState<ModelChoice | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<string[]>([]);
  const [picking, setPicking] = useState<'' | 'footage' | 'library'>('');
  const [listed, filter] = useLibraryFilter(skills);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void api.loadChat().then(setMessages);
    void api.listSkills().then(setSkills);
    void api.getModel().then(setModel);
    return api.on('agent', (event) => {
      setMessages((all) => reduce(all, event));
      if (event.type === 'done') {
        setBusy(false);
        void api.listSkills().then(setSkills); // the turn may have saved a new style
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

  const sendText = (text: string): void => {
    if (!text || busy) return;
    setMessages((all) => [...all, { role: 'user', parts: [{ type: 'text', text }], marks, files, skills: picked }, { role: 'assistant', parts: [], before: timeline ?? EMPTY_TIMELINE }]);
    setBusy(true);
    void api.send(text, marks, files, picked);
    setMarks([]);
    setFiles([]);
    setPicking('');
    setPicked([]);
  };
  sender.current = sendText;
  const send = (): void => {
    sendText(draft.trim());
    if (!busy) setDraft('');
  };
  const hasEdit = !!timeline?.clips.length;
  /** The edit as it was before reply `i`, if that reply (Claude's step) changed it. */
  const stepBack = (i: number): Timeline | undefined => {
    const before = messages[i]!.before;
    const after = messages.slice(i + 1).find((m) => m.before)?.before ?? timeline ?? EMPTY_TIMELINE;
    return before && JSON.stringify(before) !== JSON.stringify(after) ? before : undefined;
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
  const saveStyle = (): void => {
    setDraft('Save the style of this edit, and its moves, to my library. Call the style ');
    input.current?.focus();
  };

  return (
    <section className="chat">
      <div className="messages" ref={list}>
        {messages.length === 0 && (
          <p className="hint">
            Describe the video you want — “make a 30 second reel from the best moments”. Paste links to videos you like
            as references. Then mark frames or sections in the preview and say what to change.
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
            {busy && i === messages.length - 1 ? <p className="tool working">Working…</p> : stepBack(i) && (
              <button className="ghost back" title="Put the edit back to how it was before this step" onClick={() => onRestore(stepBack(i)!)}>
                <Undo2 size={14} /> Go back to before this
              </button>
            )}
          </article>
        ))}
      </div>
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
