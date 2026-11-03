import { useEffect, useState } from 'react';
import type { InvokeRes } from '@shared/ipc';
import { Terminal } from 'lucide-react';
import { api } from '../lib/api';
import { errorMessage } from '../state/navigation';
import { Notice } from '../components/Notice';
export function CodexSignIn() {
  const [status, setStatus] = useState<InvokeRes<'accounts.codex.status'> | null>(null);
  const [extension, setExtension] = useState<InvokeRes<'extensions.list'>[number] | null>(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true, checking = false;
    const check = async () => {
      if (checking) return; checking = true;
      try { const value = await api.invoke('accounts.codex.status', {}); if (active) { setStatus(value); setError(''); if (value.loggedIn) { setDeadline(null); setTimedOut(false); } } }
      catch (r) { if (active) setError(errorMessage(r)); } finally { checking = false; }
    };
    void check();
    const interval = deadline ? setInterval(() => { void check(); }, 3000) : undefined;
    const timer = deadline ? setTimeout(() => { setDeadline(null); setTimedOut(true); }, Math.max(0, deadline - Date.now())) : undefined;
    void api.invoke('extensions.list', {}).then((list) => { if (active) setExtension(list.find((e) => e.config.id === 'codex') ?? null); }).catch((r: unknown) => { if (active) setError(errorMessage(r)); });
    return () => { active = false; clearInterval(interval); clearTimeout(timer); };
  }, [refresh, deadline]);
  const launch = async () => {
    setBusy(true); setError('');
    try { await api.invoke('accounts.codex.openLogin', {}); setDeadline(Date.now() + 120000); setTimedOut(false); } catch (r) { setError(errorMessage(r)); } finally { setBusy(false); }
  };
  const toggle = async () => { if (!extension) return; setBusy(true); try { setExtension(await api.invoke('extensions.setEnabled', { id: extension.config.id, enabled: !extension.config.enabled })); } catch (r) { setError(errorMessage(r)); } finally { setBusy(false); } };
  return <div className="account-login-panel"><p><Terminal size={16} />{!status ? error ? 'Sign-in status unavailable' : 'Checking Codex…' : !status.available ? 'Codex CLI not found' : status.loggedIn ? status.mode === 'chatgpt' ? 'Signed in with ChatGPT' : status.mode === 'api-key' ? 'Codex signed in with an API key' : 'Codex is signed in' : deadline ? 'Finish signing in in Terminal' : 'Not signed in'}</p><p>Sign-in happens in Codex in Terminal. Cutroom never sees your ChatGPT password or tokens.</p>{status?.version && <p className="field-note">Codex {status.version}</p>}{status && !status.available && <p className="field-note">Install Codex in Terminal, then check again, or use an API key.</p>}{deadline && <><p className="field-note">Cutroom will check for your sign-in for up to 2 minutes.</p><progress aria-label="Checking Codex sign-in" /></>}{timedOut && <p className="field-note">Sign-in hasn't been detected yet. Finish in Terminal, then check again.</p>}{extension?.config.enabled && <p>Codex available to Claude</p>}<div className="account-actions">{status?.available && !status.loggedIn && <button className="button primary" disabled={busy} onClick={() => { void launch(); }}>{busy ? 'Opening Terminal…' : deadline ? 'Open Terminal again' : 'Open Terminal to sign in'}</button>}{status?.loggedIn && extension && <button className="button primary" disabled={busy} onClick={() => { void toggle(); }}>{busy ? extension.config.enabled ? 'Disabling…' : 'Enabling…' : extension.config.enabled ? 'Disable in Cutroom' : 'Use this sign-in'}</button>}<button className="button" disabled={busy} onClick={() => setRefresh((n) => n + 1)}>Check again</button></div>{extension?.config.enabled && <p className="field-note">Disabling this connection doesn't sign you out of Codex.</p>}{error && <Notice danger>{error}</Notice>}</div>;
}
