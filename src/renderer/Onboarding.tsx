import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { CONNECTIONS, llmProviders } from '../shared/features';
import type { Connection } from '../shared/features';
import type { ClaudeStatus, Settings } from '../shared/types';
import { api } from './lib';

const STEPS = ['Welcome', 'Connect a model', 'Sound and more', 'Where things are'];

/** The first-run guide: connect a model, offer the optional accounts, and show where everything is. */
export function Onboarding({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [saved, setSaved] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [claude, setClaude] = useState<ClaudeStatus | null>(null);
  const [codex, setCodex] = useState<ClaudeStatus | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    void api.getSettings().then((settings) => (setSaved(settings), setDraft(settings)));
    void api.codexStatus().then(setCodex);
  }, []);
  // The Claude sign-in happens in Terminal: keep looking until it is done.
  useEffect(() => {
    if (step !== 1 || claude?.loggedIn) return;
    const check = (): void => void api.claudeStatus().then(setClaude);
    check();
    const timer = setInterval(check, 3000);
    return () => clearInterval(timer);
  }, [step, claude?.loggedIn]);
  if (!draft) return null;

  const set = (patch: Partial<Settings>): void => setDraft({ ...draft, ...patch });
  /**
   * Without Claude, a provider that can run the editor (OpenRouter, Alibaba Cloud) only helps once one of its
   * models is chosen: make its first model the default while the default is still a Claude model.
   */
  const withModel = (settings: Settings): Settings => {
    const hasClaude = claude?.loggedIn || (settings.claude.auth === 'api-key' && !!settings.claude.apiKey);
    const onProvider = llmProviders(settings).some((p) => settings.model.startsWith(`${p.name}/`));
    const first = llmProviders(settings).find((p) => p.models.length);
    return hasClaude || onProvider || !first ? settings : { ...settings, model: `${first.name}/${first.models[0]}` };
  };
  /** Keep what was entered, then move on, or finish when `next` is past the last step. */
  const go = async (next: number): Promise<void> => {
    try {
      const keep = withModel(draft);
      if (keep !== saved) await api.saveSettings(keep);
      setSaved(keep);
      setDraft(keep);
      setError('');
      if (next < STEPS.length) setStep(next);
      else onClose();
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    }
  };
  const eleven = draft.elevenlabs;

  return (
    <div className="modal" onKeyDown={(e) => e.key === 'Escape' && void go(STEPS.length)}>
      <section className="dialog guide" role="dialog" aria-modal="true" aria-label="Getting started">
        <header>
          <h2>{step ? STEPS[step] : 'Welcome to Cutroom'}</h2>
          <span className="spacer" />
          <span className="note">{step + 1} of {STEPS.length}</span>
          {/* Closing keeps what was entered, like Next does. */}
          <button className="ghost round" title="Close the guide" onClick={() => void go(STEPS.length)}><X size={16} /></button>
        </header>

        <div className="body">
          {step === 0 && (
            <>
              <p>
                Cutroom edits video by conversation. Put your footage in a folder, say what you want — “make a 30 second
                reel from the best moments” — and an AI editor cuts it, adds captions, titles and sound, and shows you a
                preview you can keep changing.
              </p>
              <p>The editor needs a model to think with. The next step connects one; after that comes a short tour.</p>
            </>
          )}

          {step === 1 && (
            <>
              <h3>Claude</h3>
              <p className="hint">Runs the editor. Use your Claude subscription, or an Anthropic API key.</p>
              <div className="fields">
                <span className={claude?.loggedIn ? 'tag ok' : 'tag'}>{claude ? claude.detail : 'Checking…'}</span>
                <button type="button" onClick={() => void api.claudeLogin()}>{claude?.loggedIn ? 'Switch account' : 'Sign in to Claude'}…</button>
                {!claude?.loggedIn && <span className="hint">Opens in Terminal. This page notices when you are signed in.</span>}
              </div>
              <div className="fields">
                <span className="hint">or an API key</span>
                <input
                  type="password" className="grow" placeholder="sk-ant-…" value={draft.claude.apiKey}
                  onChange={(e) => set({ claude: { auth: e.target.value ? 'api-key' : 'claude-code', apiKey: e.target.value.trim() } })}
                />
              </div>
              <h3>ChatGPT</h3>
              <p className="hint">
                Adds Codex as a second agent and ChatGPT’s image generation, with no API key. It works alongside the model
                that runs the editor; it cannot run the editor by itself.
              </p>
              <div className="fields">
                <span className={codex?.loggedIn ? 'tag ok' : 'tag'}>{codex ? codex.detail : 'Checking…'}</span>
                <button type="button" disabled={!codex} onClick={() => (setCodex(null), void api.codexLogin().then(setCodex))}>{codex?.loggedIn ? 'Switch account' : 'Sign in with ChatGPT'}…</button>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <p className="hint">All optional. Paste a key for what you want now; the rest can wait.</p>
              <h3>ElevenLabs — audio</h3>
              <p className="hint">Voice-over, music and sound effects, and a clone of your own voice.</p>
              <input
                type="password" placeholder="ElevenLabs API key" value={eleven.apiKey}
                onChange={(e) => set({ elevenlabs: { ...eleven, apiKey: e.target.value.trim(), mode: e.target.value && eleven.mode === 'off' ? 'api' : eleven.mode } })}
              />
              <h3>Other providers</h3>
              <p className="hint">
                Generated stills and b-roll, lip sync and cutouts. OpenRouter and Alibaba Cloud can also run the editor
                instead of Claude.
              </p>
              {(Object.keys(CONNECTIONS) as Connection[]).map((id) => (
                <div className="fields" key={id}>
                  <span className="task">{CONNECTIONS[id].label}</span>
                  <input
                    type="password" className="grow" placeholder={`API key — ${CONNECTIONS[id].where}`} title={CONNECTIONS[id].where} value={draft.keys[id]}
                    onChange={(e) => set({ keys: { ...draft.keys, [id]: e.target.value.trim() } })}
                  />
                </div>
              ))}
              <p className="hint">Your own endpoints, MCP servers and voice cloning are under Home › Settings. Keys are stored encrypted on this Mac.</p>
            </>
          )}

          {step === 3 && (
            <>
              <h3>Home</h3>
              <dl>
                <dt>Projects</dt><dd>A project is a folder with your footage. Open or create one to start.</dd>
                <dt>Library</dt><dd>Styles and moves: looks you can reuse, including the ones you save from your own edits.</dd>
                <dt>Features</dt><dd>Everything Cutroom can do, where it comes from, and a switch for each.</dd>
                <dt>Settings</dt><dd>Accounts, API keys and the default model.</dd>
              </dl>
              <h3>In a project</h3>
              <dl>
                <dt>Chat</dt><dd>On the right. Say what to make or change. Each tab is its own chat with its own edit of the same footage.</dd>
                <dt>Preview</dt><dd>On the left. First the storyboard to approve, then the video. Mark a frame or a section and say what should change there.</dd>
                <dt>Add files</dt><dd>Footage, logos, music, or videos from links to use as references.</dd>
                <dt>Versions</dt><dd>Every step is kept, so you can always go back.</dd>
                <dt>Simple / Pro</dt><dd>Pro adds a timeline for editing by hand.</dd>
                <dt>Export</dt><dd>Renders the finished video into the project’s exports folder.</dd>
              </dl>
              <p className="hint">This guide can be opened again with the Guide button on Home.</p>
            </>
          )}
        </div>

        <footer>
          {error && <span className="note error">{error}</span>}
          <span className="spacer" />
          {step > 0 && <button onClick={() => void go(step - 1)}>Back</button>}
          <button className="primary" autoFocus onClick={() => void go(step + 1)}>{step === STEPS.length - 1 ? 'Get started' : 'Next'}</button>
        </footer>
      </section>
    </div>
  );
}
