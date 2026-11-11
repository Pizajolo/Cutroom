import { useEffect, useRef, useState } from 'react';
import { Mic, Plus, Square, X } from 'lucide-react';
import { CONNECTIONS } from '../shared/features';
import type { Connection } from '../shared/features';
import { modelOptions } from '../shared/types';
import type { ClaudeStatus, McpServer, Provider, Settings as SettingsData, Voice } from '../shared/types';
import { api } from './lib';

const envText = (env: Record<string, string>): string => Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n');
const parseEnv = (text: string): Record<string, string> =>
  Object.fromEntries(text.split('\n').filter((line) => line.includes('=')).map((line) => [line.slice(0, line.indexOf('=')).trim(), line.slice(line.indexOf('=') + 1)]));

/** Record yourself, then clone the recording into an ElevenLabs voice. */
function VoiceRecorder({ apiKey, onCreated }: { apiKey: string; onCreated: (voice: Voice) => void }) {
  const [name, setName] = useState('My voice');
  const [state, setState] = useState<{ step: 'idle' | 'recording' | 'recorded' | 'cloning'; seconds: number; error?: string }>({ step: 'idle', seconds: 0 });
  const recorder = useRef<MediaRecorder | null>(null);
  const recording = useRef<Blob | null>(null);

  // Count the seconds while recording.
  useEffect(() => {
    if (state.step !== 'recording') return;
    const timer = setInterval(() => setState((s) => ({ ...s, seconds: s.seconds + 1 })), 1000);
    return () => clearInterval(timer);
  }, [state.step]);

  const start = async (): Promise<void> => {
    try {
      if (!(await api.micAccess())) throw new Error('Allow microphone access for Cutroom in System Settings › Privacy & Security.');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const next = (recorder.current = new MediaRecorder(stream));
      next.ondataavailable = (e) => chunks.push(e.data);
      next.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        recording.current = new Blob(chunks, { type: next.mimeType });
        setState((s) => ({ ...s, step: 'recorded' }));
      };
      next.start();
      setState({ step: 'recording', seconds: 0 });
    } catch (e) {
      setState({ step: 'idle', seconds: 0, error: (e as Error).message });
    }
  };
  const clone = async (): Promise<void> => {
    setState((s) => ({ ...s, step: 'cloning', error: undefined }));
    try {
      onCreated(await api.cloneVoice(apiKey, name.trim(), await recording.current!.arrayBuffer()));
      setState({ step: 'idle', seconds: 0 });
    } catch (e) {
      setState((s) => ({ ...s, step: 'recorded', error: (e as Error).message }));
    }
  };

  return (
    <>
      <div className="fields">
        <input placeholder="Voice name" value={name} onChange={(e) => setName(e.target.value)} />
        {state.step === 'recording' ? (
          <button type="button" className="active" onClick={() => recorder.current?.stop()}><Square size={14} /> Stop · {state.seconds}s</button>
        ) : (
          <button type="button" disabled={state.step === 'cloning'} onClick={() => void start()}><Mic size={14} /> {state.step === 'recorded' ? 'Record again' : 'Record my voice'}</button>
        )}
        <button type="button" disabled={state.step !== 'recorded' || !name.trim()} onClick={() => void clone()}>
          {state.step === 'cloning' ? 'Creating voice…' : `Create voice${state.step === 'recorded' ? ` from ${state.seconds}s` : ''}`}
        </button>
      </div>
      <p className="hint">Record one to two minutes of yourself speaking naturally in a quiet room. Only clone your own voice.</p>
      {state.error && <p className="note error">{state.error}</p>}
    </>
  );
}

/** Connections and defaults. Changes apply to the next message sent to Claude. */
export function Settings() {
  const [saved, setSaved] = useState<SettingsData | null>(null);
  const [draft, setDraft] = useState<SettingsData | null>(null);
  const [claude, setClaude] = useState<ClaudeStatus | null>(null);
  const [codex, setCodex] = useState<ClaudeStatus | null>(null);
  const [voices, setVoices] = useState<{ list?: Voice[]; error?: string }>({});
  const [error, setError] = useState('');

  const checkClaude = (): void => void api.claudeStatus().then(setClaude);
  useEffect(() => {
    void api.getSettings().then((settings) => (setSaved(settings), setDraft(settings)));
    checkClaude();
    void api.codexStatus().then(setCodex);
  }, []);
  if (!draft) return null;

  const set = (patch: Partial<SettingsData>): void => setDraft({ ...draft, ...patch });
  // Edit one row of a list setting (providers, MCP servers).
  const row = <K extends 'providers' | 'mcp'>(key: K, index: number, patch: Partial<SettingsData[K][number]> | null): void =>
    set({ [key]: patch ? draft[key].map((item, i) => (i === index ? { ...item, ...patch } : item)) : draft[key].filter((_, i) => i !== index) });
  const save = (): void =>
    void api.saveSettings(draft).then(() => (setSaved(draft), setError('')), (e: Error) => setError(e.message));
  const eleven = draft.elevenlabs;
  const loadVoices = (): void =>
    void api.voices(eleven.apiKey).then((list) => setVoices({ list }), (e: Error) => setVoices({ error: e.message }));
  const myVoice = (voice?: Voice): void => set({ elevenlabs: { ...eleven, voice } });
  const removeVoice = (voice: Voice): void => {
    if (!confirm(`Delete the voice “${voice.name}” from your ElevenLabs account?`)) return;
    void api.deleteVoice(eleven.apiKey, voice.id).then(() => {
      if (eleven.voice?.id === voice.id) myVoice(undefined);
      loadVoices();
    }, (e: Error) => setVoices({ error: e.message }));
  };

  const models = modelOptions(draft);
  return (
    <form className="settings" onSubmit={(e) => (e.preventDefault(), save())}>
      <div className="row">
        <h1>Settings</h1>
        <span className="spacer" />
        {error && <span className="note error">{error}</span>}
        <button className="primary" disabled={draft === saved}>Save</button>
      </div>

      <section>
        <h2>Claude</h2>
        <p className="hint">Claude Code is the editor’s brain. Use your Claude subscription, or an Anthropic API key.</p>
        <label className="choice">
          <input type="radio" checked={draft.claude.auth === 'claude-code'} onChange={() => set({ claude: { ...draft.claude, auth: 'claude-code' } })} />
          Claude Code sign-in
          <span className={claude?.loggedIn ? 'tag ok' : 'tag'}>{claude ? claude.detail : 'Checking…'}</span>
          <button type="button" onClick={() => void api.claudeLogin()}>{claude?.loggedIn ? 'Switch account' : 'Sign in'}…</button>
          <button type="button" className="ghost" onClick={checkClaude}>Check again</button>
        </label>
        <label className="choice">
          <input type="radio" checked={draft.claude.auth === 'api-key'} onChange={() => set({ claude: { ...draft.claude, auth: 'api-key' } })} />
          API key
          <input type="password" className="grow" placeholder="sk-ant-…" value={draft.claude.apiKey} onChange={(e) => set({ claude: { auth: 'api-key', apiKey: e.target.value } })} />
        </label>
      </section>

      <section>
        <h2>Default model</h2>
        <p className="hint">Used by every project unless you choose another model at the bottom of that project’s chat.</p>
        <select value={models.some((m) => m.id === draft.model) ? draft.model : ''} onChange={(e) => set({ model: e.target.value })}>
          {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </section>

      <section>
        <h2>Other model providers</h2>
        <p className="hint">
          Any endpoint that speaks the Anthropic API — OpenRouter, LiteLLM, a company gateway, a local server. OpenAI and
          other non-Anthropic APIs need such a gateway in front. Their models then appear in the model lists.
        </p>
        {draft.providers.map((p: Provider, i) => (
          <div className="fields" key={i}>
            <input placeholder="Name" value={p.name} onChange={(e) => row('providers', i, { name: e.target.value })} />
            <input placeholder="https://… base URL" className="grow" value={p.baseUrl} onChange={(e) => row('providers', i, { baseUrl: e.target.value })} />
            <input type="password" placeholder="API key" value={p.apiKey} onChange={(e) => row('providers', i, { apiKey: e.target.value })} />
            <input placeholder="Models, comma-separated" className="grow" value={p.models.join(', ')} onChange={(e) => row('providers', i, { models: e.target.value.split(',').map((m) => m.trim()).filter(Boolean) })} />
            <button type="button" className="ghost" aria-label="Remove provider" onClick={() => row('providers', i, null)}><X size={14} /></button>
          </div>
        ))}
        <button type="button" onClick={() => set({ providers: [...draft.providers, { name: '', baseUrl: '', apiKey: '', models: [] }] })}><Plus size={14} /> Add provider</button>
      </section>

      <section>
        <h2>ElevenLabs</h2>
        <p className="hint">Lets Claude create voice-over, music and sound effects, and clone voices into your ElevenLabs voice library.</p>
        <div className="fields">
          <select value={draft.elevenlabs.mode} onChange={(e) => set({ elevenlabs: { ...draft.elevenlabs, mode: e.target.value as SettingsData['elevenlabs']['mode'] } })}>
            <option value="off">Not connected</option>
            <option value="api">Connect via API</option>
            <option value="mcp">Connect via MCP server</option>
          </select>
          <input type="password" className="grow" placeholder="ElevenLabs API key" value={draft.elevenlabs.apiKey} onChange={(e) => set({ elevenlabs: { ...draft.elevenlabs, apiKey: e.target.value } })} />
          <button type="button" disabled={!draft.elevenlabs.apiKey} onClick={loadVoices}>Test &amp; show voices</button>
        </div>
        {voices.error && <p className="note error">{voices.error}</p>}
        {voices.list && (
          <>
            <p className="hint">
              {voices.list.length ? 'Your voice library. Click a voice to make it the one Claude uses for voice-over.' : 'Connected. No voices in this account yet.'}
            </p>
            <p className="voices">
              {voices.list.map((v) => (
                <span key={v.id} className={v.id === eleven.voice?.id ? 'tag ok' : 'tag'}>
                  <button type="button" className="ghost" title={v.category} onClick={() => myVoice(v.id === eleven.voice?.id ? undefined : v)}>
                    {v.id === eleven.voice?.id ? '✓ ' : ''}{v.name}
                  </button>
                  {v.category === 'cloned' && (
                    <button type="button" className="ghost" aria-label={`Delete ${v.name}`} onClick={() => removeVoice(v)}><X size={12} /></button>
                  )}
                </span>
              ))}
            </p>
          </>
        )}
        {eleven.apiKey && (
          <VoiceRecorder apiKey={eleven.apiKey} onCreated={(voice) => (myVoice(voice), setVoices((v) => ({ list: [...(v.list ?? []), voice] })))} />
        )}
      </section>

      <section>
        <h2>Connections</h2>
        <p className="hint">
          Accounts that supply generated stills and b-roll, lip sync and cutouts — and, where noted, models that can run the
          editor instead of Claude. Paste a key to connect; choose what each one is used for under Home › Features.
        </p>
        {(Object.keys(CONNECTIONS) as Connection[]).map((id) => {
          const c: { label: string; pricing: string; where: string; llm?: string; models?: string } = CONNECTIONS[id];
          return (
            <div className="fields" key={id}>
              <span className="task">{c.label}</span>
              <span className="tag">{c.pricing === 'subscription' ? 'Subscription' : 'Pay per use'}</span>
              <input type="password" className="grow" placeholder={`API key — ${c.where}`} value={draft.keys[id]} onChange={(e) => set({ keys: { ...draft.keys, [id]: e.target.value.trim() } })} />
              {c.llm && (
                <input
                  title="Models this account offers for running the editor, comma-separated" placeholder={`Editor models: ${c.models}`}
                  value={draft.llmModels[id] ?? ''} onChange={(e) => set({ llmModels: { ...draft.llmModels, [id]: e.target.value } })}
                />
              )}
            </div>
          );
        })}
      </section>

      <section>
        <h2>Codex</h2>
        <p className="hint">OpenAI’s coding agent, used through Claude Code: once you are signed in with your ChatGPT account, Claude can hand tasks to Codex when you ask for it.</p>
        <div className="fields">
          <span className={codex?.loggedIn ? 'tag ok' : 'tag'}>{codex ? codex.detail : 'Checking…'}</span>
          <button type="button" onClick={() => (setCodex(null), void api.codexLogin().then(setCodex))}>{codex?.loggedIn ? 'Switch account' : 'Sign in with ChatGPT'}…</button>
        </div>
      </section>

      <section>
        <h2>MCP servers</h2>
        <p className="hint">Extra tools for Claude: a command to run, or the URL of a remote server. One KEY=VALUE per line for environment variables (or headers, for URLs).</p>
        {draft.mcp.map((m: McpServer, i) => (
          <div className="fields" key={i}>
            <input placeholder="Name" value={m.name} onChange={(e) => row('mcp', i, { name: e.target.value })} />
            <input placeholder="npx -y some-mcp-server   or   https://…/mcp" className="grow" value={m.target} onChange={(e) => row('mcp', i, { target: e.target.value })} />
            <textarea rows={2} placeholder="KEY=VALUE" defaultValue={envText(m.env)} onChange={(e) => row('mcp', i, { env: parseEnv(e.target.value) })} />
            <button type="button" className="ghost" aria-label="Remove server" onClick={() => row('mcp', i, null)}><X size={14} /></button>
          </div>
        ))}
        <div className="fields">
          <button type="button" onClick={() => set({ mcp: [...draft.mcp, { name: '', target: '', env: {} }] })}><Plus size={14} /> Add server</button>
        </div>
      </section>
    </form>
  );
}
