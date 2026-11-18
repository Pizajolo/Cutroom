import { useEffect, useRef, useState } from 'react';
import { AppWindow, ArrowUp, Film, MessageSquarePlus, Send, Sparkles, Square, Trash2, TriangleAlert, X } from 'lucide-react';
import { CAPTION_LIMITS, PLATFORMS, cleanHandle } from '../shared/social';
import type { ExportedVideo, SocialDraft, SocialSettings, SocialStatus } from '../shared/social';
import type { AgentEvent, ChatMessage } from '../shared/types';
import { Markdown } from './Markdown';
import { api } from './lib';

const clean = (error: Error): string => error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const fileName = (file: string): string => file.split('/').pop()!;

/** Fold one streamed event into the conversation. */
function reduce(messages: ChatMessage[], event: AgentEvent): ChatMessage[] {
  const last = messages.at(-1);
  if (last?.role !== 'assistant') return messages;
  const parts = [...last.parts];
  const tail = parts.at(-1);
  if (event.type === 'text' && tail?.type === 'text') parts[parts.length - 1] = { type: 'text', text: tail.text + event.text };
  else if (event.type !== 'done') parts.push(event);
  else if (event.error) parts.push({ type: 'text', text: event.error });
  return [...messages.slice(0, -1), { ...last, parts, error: event.type === 'done' ? !!event.error : last.error }];
}

const STATUS: Record<SocialDraft['status'], string> = {
  draft: 'Draft', posting: 'Posting…', waiting: 'Your turn in the window', posted: 'Posted', failed: 'Not posted', discarded: 'Discarded',
};

/** One proposed post: the video, the caption to edit, and the user's OK. */
function DraftCard({ draft, rules, status, onStatus }: { draft: SocialDraft; rules: SocialSettings; status: SocialStatus; onStatus: (s: SocialStatus) => void }) {
  const [caption, setCaption] = useState(draft.caption);
  const [manual, setManual] = useState(false);
  const [error, setError] = useState('');
  const platform = PLATFORMS[draft.platform];
  const handle = cleanHandle(rules.handles[draft.platform]);
  const limit = CAPTION_LIMITS[draft.platform];
  const signedIn = status.platforms[draft.platform].signedIn;
  const active = draft.status === 'posting' || draft.status === 'waiting';
  const stopFirst = manual || !!draft.aiGenerated;

  const post = (): void => {
    const where = `${platform.label}${handle ? ` as @${handle}` : ''}`;
    const how = stopFirst
      ? 'Cutroom fills everything in; you press Post in the Social window.'
      : 'Cutroom uploads it and presses Post. It will be public.';
    if (!confirm(`Post “${fileName(draft.video)}” to ${where}?\n\n${how}`)) return;
    setError('');
    void api.socialPost(draft.id, caption, stopFirst).then(onStatus, (e: Error) => setError(clean(e)));
  };

  return (
    <section className={`draft ${draft.status}`} aria-label={`Draft for ${platform.label}`}>
      <header>
        <strong>{platform.label}{handle && <span className="hint"> · @{handle}</span>}</strong>
        <span className={draft.status === 'failed' ? 'tag error' : active ? 'tag warn' : 'tag'}>{STATUS[draft.status]}</span>
        <span className="spacer" />
        {!active && (
          <button className="ghost round" title="Discard this draft" onClick={() => void api.socialDiscard(draft.id).then(onStatus, (e: Error) => setError(clean(e)))}>
            <Trash2 size={14} />
          </button>
        )}
      </header>
      <div className="draft-body">
        <video src={`media://post${encodeURI(draft.video)}`} controls muted preload="metadata" />
        <div className="draft-text">
          <span className="hint" title={draft.video}><Film size={12} /> {fileName(draft.video)}</span>
          <textarea value={caption} readOnly={active} onChange={(e) => setCaption(e.target.value)} aria-label="Caption" />
          <span className={caption.length > limit ? 'hint error' : 'hint'}>{caption.length} / {limit}</span>
        </div>
      </div>
      {draft.note && <p className="draft-note"><TriangleAlert size={12} /> {draft.note}</p>}
      {draft.aiGenerated && (
        <p className="draft-note"><Sparkles size={12} /> Has AI-generated content: Cutroom stops before posting so you can turn on {platform.label}’s AI label.</p>
      )}
      {draft.progress && <p className={draft.status === 'failed' ? 'note error' : 'note'}>{draft.progress}</p>}
      {error && <p className="note error">{error}</p>}
      <footer>
        {active ? (
          <button onClick={() => void api.socialShowWindow()}><AppWindow size={14} /> Show the window</button>
        ) : (
          <>
            <label className="choice hint" title={draft.aiGenerated ? 'Always on for AI-generated content' : 'Cutroom fills in everything; you press Post yourself'}>
              <input type="checkbox" checked={stopFirst} disabled={!!draft.aiGenerated} onChange={(e) => setManual(e.target.checked)} />
              I’ll press Post myself
            </label>
            <span className="spacer" />
            {!signedIn && <span className="hint">Sign in under Accounts &amp; rules</span>}
            <button className="primary" disabled={!signedIn || !caption.trim() || caption.length > limit} onClick={post}>
              <Send size={14} /> {draft.status === 'failed' ? 'Try again' : `Post to ${platform.label}`}
            </button>
          </>
        )}
      </footer>
    </section>
  );
}

/** Claude in the Social tab: pick exported videos, get captions as draft posts, post them with your OK. */
export function SocialChat({ status, rules, onStatus }: { status: SocialStatus; rules: SocialSettings; onStatus: (s: SocialStatus) => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [videos, setVideos] = useState<ExportedVideo[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState('');
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void api.socialChat().then(setMessages);
    void api.socialExports().then(setVideos);
    return api.on('social-agent', (event) => {
      setMessages((all) => reduce(all, event));
      if (event.type === 'done') setBusy(false);
    });
  }, []);
  const open = status.drafts.filter((d) => d.status === 'draft' || d.status === 'posting' || d.status === 'waiting' || d.status === 'failed').reverse();
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [messages, open.length]);

  const send = (): void => {
    const message = text.trim();
    if (!message || busy) return;
    setMessages((all) => [...all, { role: 'user', parts: [{ type: 'text', text: message }], files: picked }, { role: 'assistant', parts: [] }]);
    setBusy(true);
    setError('');
    void api.socialChatSend(message, picked).catch((e: Error) => (setError(clean(e)), setBusy(false)));
    setText('');
    setPicked([]);
    setPicking(false);
  };
  const toggle = (file: string): void => setPicked(picked.includes(file) ? picked.filter((f) => f !== file) : [...picked, file]);
  const restart = (): void => {
    if (!confirm('Start a new conversation? Drafts and posts stay.')) return;
    void api.socialChatReset().then(() => setMessages([]), (e: Error) => setError(clean(e)));
  };

  return (
    <aside className="social-chat chat">
      <header>
        <strong>Claude · captions &amp; posting</strong>
        <span className="spacer" />
        <button className="ghost" disabled={busy || !messages.length} title="Start a new conversation" onClick={restart}><MessageSquarePlus size={14} /> New chat</button>
      </header>
      <div className="messages" ref={list}>
        {messages.length === 0 && (
          <p className="hint">
            Pick exported videos and ask for captions — “Write a TikTok and an Instagram caption for this, playful, in German”.
            Claude watches the video, checks where the footage and music came from, and proposes each post as a card. Nothing is
            posted until you press Post. You can also ask about your stats or what your competitors post.
          </p>
        )}
        {messages.map((message, i) => (
          <article key={i} className={`${message.role}${message.error ? ' error' : ''}`}>
            {message.files?.map((file) => <span key={file} className="chip file"><Film size={12} /> {fileName(file)}</span>)}
            {message.parts.map((part, n) => (part.type === 'tool' ? <p key={n} className="tool">{part.text}</p> : <Markdown key={n} text={part.text} />))}
            {busy && i === messages.length - 1 && <p className="tool working">Working…</p>}
          </article>
        ))}
        {open.map((draft) => <DraftCard key={draft.id} draft={draft} rules={rules} status={status} onStatus={onStatus} />)}
      </div>
      {error && <p className="note error chat-error">{error}</p>}
      <form className="composer" onSubmit={(e) => (e.preventDefault(), send())}>
        {picking && (
          <ul className="exports">
            {videos.map((v) => (
              <li key={v.path}>
                <label className="choice" title={v.path}>
                  <input type="checkbox" checked={picked.includes(v.path)} onChange={() => toggle(v.path)} />
                  <span className="grow">{v.name}</span>
                  <span className="hint">{v.project} · {new Date(v.at).toLocaleDateString()}</span>
                </label>
              </li>
            ))}
            {videos.length === 0 && <li className="hint">No exported videos yet. Export one from a project first.</li>}
          </ul>
        )}
        {picked.length > 0 && (
          <div className="chips">
            {picked.map((file) => (
              <button type="button" key={file} className="chip file" title="Remove" onClick={() => toggle(file)}><Film size={12} /> {fileName(file)} <X size={10} /></button>
            ))}
          </div>
        )}
        <textarea
          rows={3} value={text} placeholder={picked.length ? 'What should the caption say or feel like?' : 'Pick videos, or ask about your stats…'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}
        />
        <div className="row">
          <button type="button" className={picking ? 'active' : 'ghost'} title="Choose exported videos to post" onClick={() => (setPicking(!picking), !picking && void api.socialExports().then(setVideos))}>
            <Film size={14} /> Videos{picked.length ? ` (${picked.length})` : ''}
          </button>
          <span className="spacer" />
          {busy ? (
            <button type="button" className="primary round" aria-label="Stop" onClick={() => void api.socialChatStop()}><Square size={14} /></button>
          ) : (
            <button type="submit" className="primary round" aria-label="Send" disabled={!text.trim()}><ArrowUp size={16} /></button>
          )}
        </div>
      </form>
    </aside>
  );
}
