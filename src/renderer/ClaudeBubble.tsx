import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowUp, ChevronDown, FileText, Film, Image, Paperclip, RotateCcw, Sparkles, Square, X } from 'lucide-react';
import type { AgentEvent, ChatMessage } from '../shared/types';
import { Markdown } from './Markdown';
import { api } from './lib';

/** Fold one streamed agent event into the conversation (the last message is the reply being written). */
export function foldEvent(messages: ChatMessage[], event: AgentEvent): ChatMessage[] {
  const last = messages.at(-1);
  if (last?.role !== 'assistant') return messages;
  const parts = [...last.parts];
  const tail = parts.at(-1);
  if (event.type === 'text' && tail?.type === 'text') parts[parts.length - 1] = { type: 'text', text: tail.text + event.text };
  else if (event.type !== 'done') parts.push(event);
  else if (event.error) parts.push({ type: 'text', text: event.error });
  return [...messages.slice(0, -1), { ...last, parts, ...(event.type === 'done' ? { error: !!event.error } : {}) }];
}

/** An attachment chip: the file's name with an icon for its kind. */
function FileChip({ name, onRemove }: { name: string; onRemove?: () => void }) {
  const Icon = /\.pdf$/i.test(name) ? FileText : /\.(png|jpe?g|webp|svg)$/i.test(name) ? Image : Film;
  return (
    <span className="chip file" title={name}>
      <Icon size={12} /> {name}
      {onRemove && <button type="button" className="ghost" aria-label={`Remove ${name}`} onClick={onRemove}><X size={12} /></button>}
    </span>
  );
}

/** What Claude is doing right now: its latest step, while it works. */
export const currentStep = (messages: ChatMessage[], busy: boolean): string | undefined =>
  busy ? [...(messages.at(-1)?.role === 'assistant' ? messages.at(-1)!.parts : [])].reverse().find((p) => p.type === 'tool')?.text : undefined;

export interface ChatPanelProps {
  messages: ChatMessage[];
  busy: boolean;
  onSend: (text: string, files: string[]) => void;
  onStop: () => void;
  /** Attach files (a dialog opens without `paths`); resolves with their names. Without it, nothing can be attached. */
  onAttach?: (paths?: string[]) => Promise<string[]>;
  /** What to say when only files are sent. */
  attachedText?: string;
  /** Files dropped elsewhere on the page, waiting to be attached. */
  dropped?: string[];
  onDropped?: () => void;
  /** Shown while the conversation is empty. */
  intro: ReactNode;
  /** Ready-made openings: clicking one puts it in the composer. */
  suggestions?: string[];
  placeholder: string;
  attachTitle?: string;
}

/** A conversation with Claude: its messages with every step it takes, attachments, and the composer. */
export function ChatPanel({ messages, busy, onSend, onStop, onAttach, attachedText = 'Take what you can from this.', dropped, onDropped, intro, suggestions = [], placeholder, attachTitle }: ChatPanelProps) {
  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [attaching, setAttaching] = useState('');
  const [over, setOver] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const step = currentStep(messages, busy);

  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [messages]);
  useEffect(() => input.current?.focus(), []);

  const send = (): void => {
    const text = draft.trim() || (files.length ? attachedText : '');
    if (!text || busy || attaching) return;
    onSend(text, files);
    setDraft('');
    setFiles([]);
  };
  const attach = async (paths?: string[]): Promise<void> => {
    if (!onAttach) return;
    setAttaching(paths?.length ? `Adding ${paths.length === 1 ? paths[0]!.split('/').pop() : `${paths.length} files`}…` : 'Adding…');
    try {
      const names = await onAttach(paths);
      if (names.length) setFiles((all) => [...all, ...names.filter((n) => !all.includes(n))]);
    } catch (error) {
      alert((error as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    } finally {
      setAttaching('');
    }
  };
  // Files dropped elsewhere on the page come in here.
  useEffect(() => {
    if (!dropped?.length) return;
    void attach(dropped);
    onDropped?.();
  }, [dropped]);
  const drop = onAttach
    ? {
        onDragOver: (e: React.DragEvent) => (e.preventDefault(), e.stopPropagation(), setOver(true)),
        onDragLeave: () => setOver(false),
        onDrop: (e: React.DragEvent) => {
          e.preventDefault();
          e.stopPropagation();
          setOver(false);
          void attach([...e.dataTransfer.files].map((f) => api.pathForFile(f)));
        },
      }
    : {};

  return (
    <div className={over ? 'chat-panel drop' : 'chat-panel'} {...drop}>
      <div className="messages" ref={list}>
        {messages.length === 0 && (
          <div className="intro">
            {intro}
            {suggestions.length > 0 && (
              <div className="suggestions">
                {suggestions.map((s) => (
                  <button key={s} type="button" onClick={() => (setDraft(s), input.current?.focus())}>{s}</button>
                ))}
              </div>
            )}
          </div>
        )}
        {messages.map((message, i) => (
          <article key={i} className={`${message.role}${message.error ? ' error' : ''}`}>
            {message.files?.map((name) => <FileChip key={name} name={name} />)}
            {message.parts.map((part, n) =>
              part.type === 'tool' ? <p key={n} className="tool">{part.text}</p> : <Markdown key={n} text={part.text} />,
            )}
            {busy && i === messages.length - 1 && <p className="tool working">{step ? 'Working…' : 'Thinking…'}</p>}
          </article>
        ))}
      </div>
      <form className="composer" onSubmit={(e) => (e.preventDefault(), send())}>
        {(files.length > 0 || attaching) && (
          <div className="chips">
            {files.map((name) => <FileChip key={name} name={name} onRemove={() => setFiles(files.filter((f) => f !== name))} />)}
            {attaching && <span className="note working">{attaching}</span>}
          </div>
        )}
        <textarea
          ref={input} rows={2} value={draft} placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}
        />
        <div className="row">
          {onAttach && (
            <button type="button" className="ghost" disabled={!!attaching} title={attachTitle ?? 'Attach files — or drop them here'} onClick={() => void attach()}>
              <Paperclip size={14} /> Attach
            </button>
          )}
          <span className="spacer" />
          {busy ? (
            <button type="button" className="primary round" aria-label="Stop" onClick={onStop}><Square size={14} /></button>
          ) : (
            <button type="submit" className="primary round" aria-label="Send" disabled={(!draft.trim() && !files.length) || !!attaching}><ArrowUp size={16} /></button>
          )}
        </div>
      </form>
    </div>
  );
}

interface BubbleProps extends ChatPanelProps {
  title: string;
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Start a new conversation. */
  onReset: () => void;
}

/**
 * Claude as a bubble in the lower right corner. It opens into a chat over the page that shows each step Claude
 * takes; while closed, the bubble shows the step it is on, and a dot when a reply came in.
 */
export function ClaudeBubble({ title, open, setOpen, onReset, ...panel }: BubbleProps) {
  const [unread, setUnread] = useState(false);
  const step = currentStep(panel.messages, panel.busy);
  // A reply that finished while the chat was closed is waiting to be read.
  const wasBusy = useRef(panel.busy);
  useEffect(() => {
    if (wasBusy.current && !panel.busy && !open) setUnread(true);
    wasBusy.current = panel.busy;
  }, [panel.busy, open]);
  useEffect(() => {
    if (!open) return;
    setUnread(false);
    const onKey = (e: KeyboardEvent): void => void (e.key === 'Escape' && setOpen(false));
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);
  // Files dropped on the page open the chat, which attaches them.
  useEffect(() => void (panel.dropped?.length && setOpen(true)), [panel.dropped]);
  /** Dropping onto the closed bubble opens the chat with the files. */
  const [held, setHeld] = useState<string[]>([]);

  if (!open) {
    return (
      <div
        className="claude-fab-wrap"
        onDragOver={(e) => panel.onAttach && e.preventDefault()}
        onDrop={(e) => {
          if (!panel.onAttach) return;
          e.preventDefault();
          setHeld([...e.dataTransfer.files].map((f) => api.pathForFile(f)));
          setOpen(true);
        }}
      >
        {panel.busy && <button className="claude-status" onClick={() => setOpen(true)}><span className="working">{step ?? 'Thinking…'}</span></button>}
        {!panel.busy && unread && <button className="claude-status" onClick={() => setOpen(true)}>Claude replied</button>}
        <button className={panel.busy ? 'claude-fab busy' : 'claude-fab'} title={`${title} — ask Claude`} aria-label={`Open ${title}`} onClick={() => setOpen(true)}>
          <Sparkles size={20} />
          {unread && <i className="dot" />}
        </button>
      </div>
    );
  }

  return (
    <section className="claude-overlay" role="dialog" aria-label={title}>
      <header>
        <Sparkles size={16} />
        <strong>{title}</strong>
        <span className="spacer" />
        <button className="ghost round" title="New conversation" aria-label="New conversation" disabled={panel.busy || !panel.messages.length} onClick={onReset}><RotateCcw size={14} /></button>
        <button className="ghost round" title="Minimise (Esc)" aria-label="Minimise" onClick={() => setOpen(false)}><ChevronDown size={16} /></button>
      </header>
      <ChatPanel
        {...panel}
        dropped={held.length ? held : panel.dropped}
        onDropped={() => (held.length ? setHeld([]) : panel.onDropped?.())}
      />
    </section>
  );
}
