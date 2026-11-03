import { useCallback, useEffect, useState } from 'react';
import { extensionConfigSchema, secretEnvNameSchema, type ExtensionConfig, type ExtensionInfo } from '@shared/schema/extensions';
import type { InvokeRes } from '@shared/ipc';
import { api } from '../lib/api';
import { errorMessage } from '../state/navigation';
import { Dialog } from '../components/Dialog';
import { Notice } from '../components/Notice';
import { useAccounts } from '../lib/useAccounts';
import { openSettings } from './WorkspaceSettings';

export function ExtensionsSettings() {
  const [list, setList] = useState<ExtensionInfo[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [add, setAdd] = useState(false);
  const [remove, setRemove] = useState<ExtensionInfo | null>(null);
  const { data: accounts, error: accountError } = useAccounts();
  const [codex, setCodex] = useState<InvokeRes<'accounts.codex.status'> | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  useEffect(() => { let active = true; void api.invoke('accounts.codex.status', {}).then((value) => { if (active) setCodex(value); }).catch((r: unknown) => { if (active) setRowErrors((errors) => ({ ...errors, codex: errorMessage(r) })); }); return () => { active = false; }; }, []);
  const prerequisite = (info: ExtensionInfo) => info.config.id === 'elevenlabs' && !accounts?.some((a) => a.provider === 'elevenlabs' && a.status === 'connected') ? accountError ?? 'Connect ElevenLabs in Accounts to enable these tools.' : info.config.id === 'codex' ? !codex ? 'Checking Codex…' : !codex.available ? 'Codex CLI not found' : !codex.loggedIn ? 'Sign-in required' : null : null;
  const load = useCallback(async () => { try { setList(await api.invoke('extensions.list', {})); } catch (r) { setError(errorMessage(r)); } }, []);
  useEffect(() => { let active = true; void api.invoke('extensions.list', {}).then((value) => { if (active) setList(value); }).catch((r: unknown) => { if (active) setError(errorMessage(r)); }); return () => { active = false; }; }, []);
  const toggle = async (info: ExtensionInfo) => {
    if (busy || !info.config.enabled && prerequisite(info)) return;
    setBusy(info.config.id); setRowErrors((errors) => ({ ...errors, [info.config.id]: '' }));
    try { const value = await api.invoke('extensions.setEnabled', { id: info.config.id, enabled: !info.config.enabled }); setList((prev) => prev?.map((i) => i.config.id === value.config.id ? value : i) ?? null); }
    catch (r) { setRowErrors((errors) => ({ ...errors, [info.config.id]: errorMessage(r) })); } finally { setBusy(null); }
  };
  return <div className="settings-form"><p>Choose the tools available to Claude. Adding a server can give that server access to your files or external services.</p>{error && <Notice danger>{error}</Notice>}{!list ? <p role="status">Loading extensions…</p> : <div>{list.map((info) => <section className="extension-row" key={info.config.id}><div><h3>{info.config.name}{info.config.id === 'elevenlabs-hosted' && <small> · Experimental</small>}</h3><p className="field-note">{info.detail ?? (info.config.id === 'cutroom' ? 'Project, media and timeline tools. Source files are protected.' : info.config.id === 'codex' ? 'Claude can ask Codex for a read-only analysis. Codex cannot change this edit.' : info.config.id === 'elevenlabs' ? 'Uses your saved ElevenLabs API key for voices, audio generation and transcription.' : info.config.id === 'elevenlabs-hosted' ? 'Experimental hosted server. Hosted sign-in is not available in Cutroom; use the built-in ElevenLabs tools with a saved API key.' : info.config.transport === 'http' ? info.config.url : info.config.command)}</p><span className="field-note">{info.config.id === 'cutroom' ? 'Always on · Locked' : info.status === 'ready' ? 'Ready' : info.status === 'disabled' ? 'Disabled' : info.status === 'unavailable' ? 'Unavailable' : 'Needs attention'}</span>{info.config.id === 'elevenlabs-hosted' && <p className="field-note">Hosted sign-in isn't available in this build. Use the built-in ElevenLabs connection instead.</p>}{prerequisite(info) && <p className="field-note">{prerequisite(info)} <button className="button" onClick={() => openSettings('Accounts')}>Open Accounts</button></p>}{rowErrors[info.config.id] && <Notice danger>{rowErrors[info.config.id]}</Notice>}{!info.builtin && <details><summary>Review configuration</summary><pre>{JSON.stringify(info.config, null, 2)}</pre><p className="field-note">Credentials: {info.secretEnvNames.join(', ') || 'None'} · Stored in Keychain</p></details>}</div>{info.config.id !== 'cutroom' && <label className="check-row"><input type="checkbox" aria-label={`Enable ${info.config.name}`} checked={info.config.enabled} disabled={!!busy || !info.config.enabled && !!prerequisite(info)} onChange={() => { void toggle(info); }} />{busy === info.config.id ? 'Saving…' : 'Enabled'}</label>}{!info.builtin && <button className="button" onClick={() => setRemove(info)}>Remove</button>}</section>)}</div>}<button className="button" onClick={() => setAdd(true)}>Add MCP server</button>
    {add && <ExtensionForm onClose={() => setAdd(false)} onAdded={() => { setAdd(false); void load(); }} />}
    {remove && <Dialog title="Remove this MCP server?" onClose={() => { if (!busy) setRemove(null); }} footer={<><button className="button" autoFocus disabled={!!busy} onClick={() => setRemove(null)}>Cancel</button><button className="button danger" disabled={!!busy} onClick={() => { setBusy(remove.config.id); void api.invoke('extensions.remove', { id: remove.config.id }).then(() => { setRemove(null); void load(); }).catch((r: unknown) => setError(errorMessage(r))).finally(() => setBusy(null)); }}>Remove server</button></>}><p>Remove {remove.config.name} from Cutroom and remove its saved credential references? This doesn't uninstall its executable or revoke access at the provider.</p>{error && <Notice danger>{error}</Notice>}</Dialog>}
  </div>;
}
function ExtensionForm({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [config, setConfig] = useState<ExtensionConfig>({ id: '', name: '', enabled: false, transport: 'stdio', command: '', args: [] });
  const [paste, setPaste] = useState('');
  const [envName, setEnvName] = useState('');
  const [secret, setSecret] = useState('');
  const [review, setReview] = useState<InvokeRes<'extensions.validate'> | null>(null);
  const [trust, setTrust] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const validate = async () => {
    setError('');
    try {
      const parsed = extensionConfigSchema.parse(config);
      if (parsed.transport === 'stdio' && !parsed.command.startsWith('/')) throw new Error('Executable must be an absolute path. Arguments are separate values, not a shell command.');
      if (parsed.transport === 'http' && !parsed.url.startsWith('https://')) throw new Error('Use an HTTPS server URL.');
      if (secret) secretEnvNameSchema.parse(envName);
      setBusy(true); setReview(await api.invoke('extensions.validate', { config: parsed })); setTrust(false);
    } catch (r) { setError(errorMessage(r)); } finally { setBusy(false); }
  };
  const install = async () => {
    if (!review || !trust || busy) return;
    setBusy(true); setError('');
    const secretEnv = secret ? { [envName]: secret } : undefined; setSecret('');
    try { await api.invoke('extensions.add', { config, ...(secretEnv ? { secretEnv } : {}) }); onAdded(); }
    catch (r) { setError(errorMessage(r)); setReview(null); setTrust(false); } finally { setBusy(false); }
  };
  return <Dialog title={review ? 'Review MCP server' : 'Add MCP server'} wide onClose={() => { if (!busy) { setSecret(''); onClose(); } }} footer={<>{review && <button className="button" disabled={busy} onClick={() => { setReview(null); setTrust(false); }}>Back</button>}<button className="button" autoFocus={!!review} disabled={busy} onClick={() => { setSecret(''); onClose(); }}>Cancel</button><button className="button primary" disabled={busy || (!!review && !trust)} onClick={() => { void (review ? install() : validate()); }}>{busy ? 'Working…' : review ? 'Install' : 'Review server'}</button></>}>
    {review ? <div className="settings-form"><h3>Command</h3><pre>{review.commandPreview}</pre><h3>Network domains</h3><p>{review.domains.length ? review.domains.join(', ') : 'Not declared'}</p><h3>File access and sandbox</h3><ul>{review.scopes.map((s) => <li key={s}>{s}</li>)}</ul><p>These are the declared scopes. A local server runs as your user; install only servers you trust.</p><h3>Credentials</h3><p>{secret ? envName : 'None'}{secret && ' · Stored in Keychain'}</p><p className="field-note">The enabled server receives these credentials. Values are never included in this preview.</p><label className="check-row"><input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} />I trust this server with the access shown above.</label></div> : <div className="settings-form"><div className="form-row"><label className="form-field">Display name<input value={config.name} onChange={(e) => setConfig({ ...config, name: e.target.value })} /></label><label className="form-field">Server id<input value={config.id} onChange={(e) => setConfig({ ...config, id: e.target.value })} /></label></div><fieldset><legend>Transport</legend><label className="check-row"><input type="radio" checked={config.transport === 'stdio'} onChange={() => setConfig({ id: config.id, name: config.name, enabled: false, transport: 'stdio', command: '', args: [] })} />Local command (stdio)</label><label className="check-row"><input type="radio" checked={config.transport === 'http'} onChange={() => setConfig({ id: config.id, name: config.name, enabled: false, transport: 'http', url: '' })} />HTTPS server</label></fieldset>{config.transport === 'stdio' ? <><label className="form-field">Executable (absolute path)<input value={config.command} onChange={(e) => setConfig({ ...config, command: e.target.value })} /></label><label className="form-field">Arguments (one value per line)<textarea value={config.args.join('\n')} onChange={(e) => setConfig({ ...config, args: e.target.value ? e.target.value.split('\n') : [] })} /></label><div className="form-row"><label className="form-field">Environment name<input value={envName} onChange={(e) => setEnvName(e.target.value)} autoComplete="off" /></label><label className="form-field">Secret value<input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" /></label></div></> : <label className="form-field">Server URL<input type="url" value={config.url} onChange={(e) => setConfig({ ...config, url: e.target.value })} /></label>}<details><summary>Paste configuration JSON</summary><textarea aria-label="Configuration JSON" value={paste} onChange={(e) => setPaste(e.target.value)} /><button className="button" onClick={() => { try { setConfig(extensionConfigSchema.parse(JSON.parse(paste))); setPaste(''); setError(''); } catch { setError('Invalid configuration JSON. Check its fields and transport. Nothing has been executed.'); } }}>Import into form</button></details></div>}{error && <Notice danger>{error}</Notice>}
  </Dialog>;
}
