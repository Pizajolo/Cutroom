import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Circle, CircleAlert, CircleCheck, CloudOff, LockKeyhole, Terminal } from 'lucide-react';
import { IpcFailure } from '@shared/ipc';
import type { AccountInfo, ClaudeCodeStatus, Provider } from '@shared/schema/accounts';
import { api } from '../lib/api';
import { accountMethodLabel, accountRevision, receiveAccount, useAccounts } from '../lib/useAccounts';
import { Dialog } from '../components/Dialog';
import { Notice } from '../components/Notice';
import { ProgressBar } from '../components/InstallProgress';

const PROVIDERS = { anthropic: 'Claude', openai: 'OpenAI', elevenlabs: 'ElevenLabs' } as const;
const STATUS = {
  connected: { label: 'Connected', Icon: CircleCheck, className: 'connected' },
  not_connected: { label: 'Not connected', Icon: Circle, className: 'not-connected' },
  invalid: { label: 'Key rejected', Icon: CircleAlert, className: 'invalid' },
  unreachable: { label: "Can't reach service", Icon: CloudOff, className: 'unreachable' },
} as const;
const safeError = (reason: unknown, fallback: string) => reason instanceof IpcFailure ? reason.message : fallback;

function ConnectionBadge({ status }: { status: AccountInfo['status'] }) {
  const { label, Icon, className } = STATUS[status];
  return <span className={`connection-status is-${className}`}><Icon size={14} aria-hidden="true" />{label}</span>;
}

function ClaudeSignIn({ disabled, onUse }: { disabled: boolean; onUse: () => void }) {
  const [status, setStatus] = useState<ClaudeCodeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [opening, setOpening] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    let active = true;
    let inFlight = false;
    const check = () => {
      if (inFlight) return;
      inFlight = true;
      void api.invoke('accounts.claudeCode.status', {}).then((value) => {
        if (!active) return;
        setStatus(value); setError(null);
        if (value.loggedIn) { setDeadline(null); setTimedOut(false); }
      }).catch((reason: unknown) => { if (active) setError(safeError(reason, 'Claude Code sign-in status is unavailable.')); })
        .finally(() => { inFlight = false; if (active) setChecking(false); });
    };
    check();
    const interval = deadline === null ? undefined : window.setInterval(check, 3000);
    const timeout = deadline === null ? undefined : window.setTimeout(() => { setDeadline(null); setTimedOut(true); }, Math.max(0, deadline - Date.now()));
    return () => { active = false; window.clearInterval(interval); window.clearTimeout(timeout); };
  }, [deadline, refresh]);
  const openLogin = async () => {
    setOpening(true); setError(null);
    try { await api.invoke('accounts.claudeCode.openLogin', {}); setTimedOut(false); setDeadline(Date.now() + 120_000); }
    catch (reason: unknown) { setError(safeError(reason, 'Terminal sign-in is unavailable.')); }
    finally { setOpening(false); }
  };
  return <div className="account-login-panel">
    <p><Terminal size={16} aria-hidden="true" /> {status === null ? 'Checking Claude Code…' : !status.available ? 'Claude Code not found' : status.loggedIn ? status.email ? `Signed in as ${status.email}` : 'Claude Code is signed in' : deadline !== null ? 'Finish signing in in Terminal' : 'Not signed in'}</p>
    <p>Sign-in happens in Claude Code in Terminal. Cutroom never sees your Claude password or tokens.</p>
    {status?.cliVersion && <p className="field-note">Claude Code {status.cliVersion}</p>}
    {status && !status.available && <p className="field-note">Use an API key, or install Claude Code and check again.</p>}
    {deadline !== null && <><p className="field-note">Cutroom will check for your sign-in for up to 2 minutes.</p><ProgressBar name="Checking Claude Code sign-in" text="Waiting for sign-in in Terminal" /></>}
    {timedOut && <p className="field-note">Sign-in hasn't been detected yet. Finish in Terminal, then check again.</p>}
    {error && <Notice danger>{error}</Notice>}
    <div className="account-actions">
      {status?.available && !status.loggedIn && <button type="button" className={`button${deadline === null ? ' primary' : ''}`} disabled={disabled || opening} onClick={() => void openLogin()}>{opening ? 'Opening Terminal…' : deadline === null ? 'Open Terminal to sign in' : 'Open Terminal again'}</button>}
      {status?.available && status.loggedIn && <button type="button" className="button primary" disabled={disabled} onClick={onUse}>{disabled ? 'Connecting…' : 'Use this sign-in'}</button>}
      <button type="button" className="button" disabled={disabled || checking} onClick={() => { setChecking(true); setRefresh((value) => value + 1); }}>{checking ? 'Checking…' : 'Check again'}</button>
    </div>
  </div>;
}

function AccountCard({ account }: { account: AccountInfo }) {
  const name = PROVIDERS[account.provider];
  const id = useId();
  const [candidate, setCandidate] = useState<AccountInfo['method']>(null);
  const method = candidate ?? (account.status === 'not_connected' ? 'api-key' : account.method) ?? 'api-key';
  const [key, setKey] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [disconnecting, setDisconnecting] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const verify = useRef<HTMLButtonElement>(null);
  const radio = useRef<HTMLInputElement>(null);
  const focus = useRef<'input' | 'verify' | 'connection' | null>(null);
  useEffect(() => {
    if (pending || !focus.current) return;
    const target = focus.current === 'verify' ? verify.current : focus.current === 'connection' && account.provider === 'anthropic' ? radio.current : input.current;
    target?.focus(); focus.current = null;
  });
  const saved = account.status !== 'not_connected' && (account.method !== null || account.keyPreview !== null);
  const run = async (action: string, invoke: () => Promise<AccountInfo>) => {
    setPending(action); setError(null); setAnnouncement('');
    const revision = accountRevision();
    try {
      const result = await invoke(); receiveAccount(result, revision);
      if (action === 'disconnect') {
        setDisconnecting(false); setCandidate(null); focus.current = 'connection'; setAnnouncement(`${name} disconnected.`);
      } else if (action === 'connect') {
        setCandidate(null); focus.current = 'verify'; setAnnouncement(`${name} connected.`);
      }
    } catch (reason: unknown) {
      setError(safeError(reason, `${name} connection is unavailable. Please try again.`));
      if (action === 'connect') focus.current = 'input';
    } finally { setPending(null); }
  };
  const submitKey = (event: FormEvent) => {
    event.preventDefault(); if (pending || !key.trim()) return;
    const apiKey = key.trim(); setKey('');
    void run('connect', () => api.invoke('accounts.connectKey', { provider: account.provider, apiKey }));
  };
  const keyForm = <>
    {(account.status !== 'connected' || account.method !== 'api-key') && <form className="account-key-form" onSubmit={submitKey}>
      <label className="account-key-field" htmlFor={`${id}-key`}>{name} API key<input ref={input} id={`${id}-key`} type="password" autoComplete="off" spellCheck={false} autoCapitalize="none" placeholder="Paste your API key" value={key} onChange={(event) => setKey(event.target.value)} disabled={pending !== null} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} /></label>
      <button type="submit" className="button primary" disabled={pending !== null || !key.trim()}>{pending === 'connect' ? 'Connecting…' : saved && account.method === 'api-key' ? 'Replace key' : 'Connect'}</button>
    </form>}
    <p className="field-note">Create an API key at <span className="settings-text-link">{account.provider === 'anthropic' ? 'platform.claude.com' : account.provider === 'openai' ? 'platform.openai.com' : 'elevenlabs.io'}</span>.</p>
  </>;
  return <section className="account-card" aria-labelledby={`${id}-title`}>
    <div className="account-card-header"><div><h3 className="account-provider" id={`${id}-title`}>{name}</h3><p className="account-description">{account.provider === 'anthropic' ? 'Choose how Cutroom connects to Claude.' : account.provider === 'openai' ? 'Connect your OpenAI account with an API key.' : 'Connect voice and audio services with an API key.'}</p></div><ConnectionBadge status={account.status} /></div>
    {saved && <div className="account-saved"><span>{accountMethodLabel(account)}</span>{account.keyPreview && <span>{account.keyPreview}</span>}<div className="account-actions"><button ref={verify} type="button" className="button" disabled={pending !== null} onClick={() => void run('verify', () => api.invoke('accounts.verify', { provider: account.provider }))}>{pending === 'verify' ? 'Checking…' : 'Verify'}</button><button type="button" className="button" disabled={pending !== null} onClick={() => { setError(null); setDisconnecting(true); }}>Disconnect</button></div></div>}
    {account.detail && <p className="account-description">{account.detail}</p>}
    {account.status === 'unreachable' && <p className="field-note">Your saved connection hasn't been removed.</p>}
    <p className="account-meta">Last checked: {account.checkedAt ? <time dateTime={account.checkedAt} title={new Date(account.checkedAt).toLocaleString()}>{new Date(account.checkedAt).toLocaleString()}</time> : 'Not checked yet'}</p>
    {account.provider === 'anthropic' ? <fieldset className="account-methods" disabled={pending !== null}><legend>Connection method</legend>
      <label className="account-method"><input ref={radio} type="radio" name={`${id}-method`} value="api-key" checked={method === 'api-key'} onChange={() => { setCandidate('api-key'); setKey(''); setError(null); }} />API key from Claude Console <span className="method-recommended">Recommended</span></label>
      {method === 'api-key' && <div className="account-method-body">{keyForm}</div>}
      <label className="account-method"><input type="radio" name={`${id}-method`} value="claude-code" checked={method === 'claude-code'} onChange={() => { setCandidate('claude-code'); setKey(''); setError(null); }} />Use my Claude Code sign-in</label>
      {method === 'claude-code' && <div className="account-method-body"><ClaudeSignIn disabled={pending !== null} onUse={() => void run('connect', () => api.invoke('accounts.claude.setMethod', { method: 'claude-code' }))} /></div>}
      {saved && method !== account.method && <p className="field-note">Current connection stays active until you connect another method.</p>}
    </fieldset> : keyForm}
    {error && !disconnecting && <div id={`${id}-error`}><Notice danger>{error}</Notice></div>}
    <span className="sr-only" role="status">{announcement}</span>
    {disconnecting && <Dialog title={`Disconnect ${name}?`} onClose={() => { if (!pending) setDisconnecting(false); }} footer={<><button type="button" className="button" autoFocus disabled={pending !== null} onClick={() => setDisconnecting(false)}>Cancel</button><button type="button" className="button danger" disabled={pending !== null} onClick={() => void run('disconnect', () => api.invoke('accounts.disconnect', { provider: account.provider }))}>{pending === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}</button></>}><p>{account.method === 'claude-code' ? "This removes the connection from Cutroom. It won't sign you out of Claude Code." : 'Cutroom will remove this API key from your macOS Keychain. You can reconnect later.'}</p>{error && <Notice danger>{error}</Notice>}</Dialog>}
  </section>;
}

export function Accounts() {
  const { data: accounts, error, retry } = useAccounts();
  return <div className="accounts-settings"><p className="settings-intro">Connect the services you use in Cutroom.</p><p className="account-security-note"><LockKeyhole size={14} aria-hidden="true" />API keys are stored in your macOS Keychain. Cutroom only shows the last four characters.</p>
    {error && <Notice danger action={<button type="button" className="button" onClick={() => void retry()}>Retry connections check</button>}>{error}</Notice>}
    {!accounts && !error && <p role="status">Checking connections…</p>}
    {accounts && <div className="accounts-list">{(['anthropic', 'openai', 'elevenlabs'] satisfies Provider[]).map((provider) => { const account = accounts.find((entry) => entry.provider === provider); return account ? <AccountCard key={provider} account={account} /> : null; })}</div>}
  </div>;
}
