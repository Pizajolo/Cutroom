import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { GlobalSettings, SettingsPatch } from '@shared/schema/settings';
import { sandboxSettingsSchema, settingsPatchSchema } from '@shared/schema/settings';
import { requestNavigation, useSettingsGuard } from '../state/settingsDraft';
import { useSettings } from '../lib/resources';
import { api } from '../lib/api';
import { useAccounts } from '../lib/useAccounts';
import { useModels, useTools } from '../lib/useTools';
import { errorMessage, useNavigation, type SettingsSection } from '../state/navigation';
import { Notice } from '../components/Notice';
import { Dialog } from '../components/Dialog';
import { VoiceButton } from '../components/VoiceButton';
import { StorageSettings } from './StorageSettings';
import { ExtensionsSettings } from './ExtensionsSettings';
import { PresetSettings } from './PresetSettings';

export function WorkspaceSettings({ section }: { section: SettingsSection }) {
  const { data, error, retry } = useSettings();
  if (!data) return error ? <Notice danger action={<button className="button" onClick={() => { void retry(); }}>Retry</button>}>{error}</Notice> : <p role="status">Loading settings…</p>;
  return <>{error && <Notice danger>{error}</Notice>}{section === 'Sandbox' ? <SandboxSettings settings={data} /> : section === 'Voice input' ? <VoiceSettings settings={data} /> : section === 'Render presets' ? <PresetSettings settings={data} /> : section === 'Storage / snapshots' ? <StorageSettings settings={data} /> : <ExtensionsSettings />}</>;
}
export function DraftActions({ dirty, valid = true, busy, saved, save, discard }: { dirty: boolean; valid?: boolean; busy: boolean; saved: boolean; save: () => void; discard: () => void }) {
  return <div className="settings-actions"><button className="button primary" disabled={!dirty || !valid || busy} onClick={save}>{busy ? 'Saving…' : 'Save changes'}</button><button className="button" disabled={!dirty || busy} onClick={discard}>Discard</button><span role="status" className="field-note">{saved && !dirty ? 'Saved' : dirty ? 'Unsaved changes' : ''}</span></div>;
}
export function useSettingsDraft<T>(initial: T, patch: (draft: T) => SettingsPatch) {
  const [draft, setDraft] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  const [incoming, setIncoming] = useState(JSON.stringify(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  if (JSON.stringify(initial) !== incoming) {
    if (!dirty) setDraft(initial);
    setBaseline(initial);
    setIncoming(JSON.stringify(initial));
  }
  const save = useCallback(async () => {
    if (busy) return false;
    setBusy(true); setError('');
    try { await api.invoke('settings.update', { patch: settingsPatchSchema.parse(patch(draft)) }); setBaseline(draft); setSaved(true); return true; }
    catch (r) { setError(errorMessage(r)); return false; } finally { setBusy(false); }
  }, [busy, draft, patch]);
  useEffect(() => {
    if (!dirty) return;
    const guard = { save, preview: draft, discard: () => { setDraft(baseline); setError(''); } };
    useSettingsGuard.setState({ guard });
    return () => { if (useSettingsGuard.getState().guard === guard) useSettingsGuard.setState({ guard: null }); };
  }, [dirty, draft, baseline, save]);
  return { draft, setDraft, dirty, busy, error, saved, save, discard: () => { setDraft(baseline); setError(''); } };
}
export function SettingRow({ title, help, children }: { title: string; help?: string; children: ReactNode }) {
  return <div className="setting-row"><div><h3>{title}</h3>{help && <p className="field-note">{help}</p>}</div><div className="setting-controls">{children}</div></div>;
}
export const openSettings = (section: SettingsSection) => requestNavigation(() => useNavigation.setState({ settingsSection: section, destination: 'settings' }));
function SandboxSettings({ settings }: { settings: GlobalSettings }) {
  const form = useSettingsDraft(settings.sandbox, (sandbox) => ({ sandbox }));
  const [domain, setDomain] = useState('');
  const [validation, setValidation] = useState('');
  const [review, setReview] = useState(false);
  const schemaAllowsShell = sandboxSettingsSchema.shape.allowShell.safeParse(true).success;
  const schemaAllowsWeb = sandboxSettingsSchema.shape.allowWeb.safeParse(true).success;
  const add = () => {
    const hostname = domain.trim().toLowerCase();
    if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(hostname)) { setValidation('Enter a hostname, such as example.com, without https:// or a path.'); return; }
    if (form.draft.allowedDomains.includes(hostname)) { setValidation('This domain is already allowed.'); return; }
    if (form.draft.allowedDomains.length >= 50) { setValidation('Allow up to 50 domains.'); return; }
    form.setDraft({ ...form.draft, allowedDomains: [...form.draft.allowedDomains, hostname] }); setDomain(''); setValidation('');
  };
  const save = () => {
    if ((!settings.sandbox.allowShell && form.draft.allowShell) || form.draft.allowedDomains.some((d) => !settings.sandbox.allowedDomains.includes(d))) setReview(true);
    else void form.save();
  };
  return <div className="settings-form"><p>Control which tools Claude can use in this project. Your source media stays protected.</p><div className="scope-inset"><h3>Protected project files</h3><p>Agents can write compositions/ and work/. Footage, references, assets and Folder root files are read-only. Timeline changes go through Cutroom's editing tools and can be undone.</p></div>
    <SettingRow title="Network for sandboxed commands" help="Network is never enabled by default."><span>Off by default · Locked</span></SettingRow>
    <SettingRow title="Allow shell commands in the sandbox" help="Allows Claude to run commands. Source media remains read-only; command network access is restricted to the allowed domains below."><label className="check-row"><input type="checkbox" checked={form.draft.allowShell} disabled={!schemaAllowsShell} onChange={(e) => form.setDraft({ ...form.draft, allowShell: e.target.checked as typeof form.draft.allowShell })} />{form.draft.allowShell ? 'On' : 'Off'}</label>{!schemaAllowsShell && <p className="field-note">Shell commands are disabled by the runtime policy.</p>}</SettingRow>
    <SettingRow title="Allow web search and fetch" help="Searches and fetched pages are processed externally. This does not give shell commands unrestricted network access."><label className="check-row"><input type="checkbox" checked={form.draft.allowWeb} disabled={!schemaAllowsWeb} onChange={(e) => form.setDraft({ ...form.draft, allowWeb: e.target.checked as typeof form.draft.allowWeb })} />{form.draft.allowWeb ? 'On' : 'Off'}</label>{!schemaAllowsWeb && <p className="field-note">Web tools are disabled by the runtime policy.</p>}</SettingRow>
    <section><label className="form-field" htmlFor="allowed-domain">Allowed domains</label><div className="form-row"><input id="allowed-domain" value={domain} placeholder="example.com" aria-invalid={!!validation} aria-describedby="domain-error" onChange={(e) => setDomain(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} /><button className="button" onClick={add}>Add</button></div>{validation && <p id="domain-error" className="field-error" role="alert">{validation}</p>}{form.draft.allowedDomains.length ? <ul className="domain-list">{form.draft.allowedDomains.map((d) => <li key={d}><span>{d}</span><button className="button quiet-button" aria-label={`Remove ${d}`} onClick={() => form.setDraft({ ...form.draft, allowedDomains: form.draft.allowedDomains.filter((v) => v !== d) })}>Remove</button></li>)}</ul> : <p className="field-note">No domains allowed for sandboxed commands.</p>}</section>
    <p className="field-note">Built-in imports and enabled service integrations use their own explicit permissions.</p>{form.error && <Notice danger>{form.error}</Notice>}<DraftActions {...form} save={save} />
    {review && <Dialog title="Allow these sandbox tools?" onClose={() => setReview(false)} footer={<><button className="button" autoFocus onClick={() => setReview(false)}>Cancel</button><button className="button primary" disabled={form.busy} onClick={() => { void form.save().then((ok) => { if (ok) setReview(false); }); }}>Save sandbox settings</button></>}><p>Shell: {form.draft.allowShell ? 'Allowed' : 'Off'}. Web: {form.draft.allowWeb ? 'Allowed' : 'Off'}.</p><h3>Added domains</h3><ul>{form.draft.allowedDomains.filter((d) => !settings.sandbox.allowedDomains.includes(d)).map((d) => <li key={d}>{d}</li>)}</ul>{form.error && <Notice danger>{form.error}</Notice>}</Dialog>}
  </div>;
}
function VoiceSettings({ settings }: { settings: GlobalSettings }) {
  const { data: accounts, error: accountError } = useAccounts();
  const { data: tools } = useTools();
  const { data: models } = useModels();
  const [test, setTest] = useState('');
  const connected = accounts?.some((a) => a.provider === 'elevenlabs' && a.status === 'connected');
  const installed = models?.filter((m) => m.status === 'installed') ?? [];
  const whisperReady = tools?.some((t) => t.name === 'whisper-cli' && t.status === 'ok');
  const form = useSettingsDraft(settings.voiceInput, (voiceInput) => {
    if (voiceInput.engine === 'scribe' ? !connected : !whisperReady || !installed.some((m) => m.name === voiceInput.model)) throw new Error('The selected voice engine is not ready. Check Accounts or Tools before saving.');
    return { voiceInput };
  });
  const valid = form.draft.engine === 'scribe' ? connected : whisperReady && installed.some((m) => m.name === form.draft.model);
  return <div className="settings-form"><p>Turn a microphone recording into text. Nothing is sent as a message until you choose Send or Start.</p><fieldset><legend>Engine</legend><label className="check-row"><input type="radio" name="voice-engine" checked={form.draft.engine === 'whisper'} onChange={() => form.setDraft({ ...form.draft, engine: 'whisper' })} />Local Whisper</label><p className="field-note">Processed on this Mac.</p><label className="form-field">Installed model<select disabled={form.draft.engine !== 'whisper' || !installed.length} value={form.draft.model} onChange={(e) => form.setDraft({ ...form.draft, model: e.target.value })}>{!installed.some((m) => m.name === form.draft.model) && <option value={form.draft.model}>{form.draft.model} · Not installed</option>}{installed.map((m) => <option key={m.name} value={m.name}>{m.name} · Installed</option>)}</select></label>{!whisperReady && <p className="field-note">Whisper needs a local build before voice input can run. Build whisper-cli, then check again in Tools.</p>}{!installed.length && <p className="field-note">Choose a model after downloading one.</p>}<button className="button" onClick={() => openSettings('Tools')}>Open Tools</button><label className="check-row"><input type="radio" name="voice-engine" checked={form.draft.engine === 'scribe'} disabled={!connected} onChange={() => form.setDraft({ engine: 'scribe', model: 'scribe_v1' })} />ElevenLabs Scribe <small>External processing</small></label><p className="field-note">Recordings are sent to ElevenLabs for transcription.</p>{!connected && <p className="field-note">{accountError ?? 'Connect ElevenLabs in Accounts to use Scribe.'}</p>}<button className="button" onClick={() => openSettings('Accounts')}>Open Accounts</button></fieldset>{form.error && <Notice danger>{form.error}</Notice>}<DraftActions {...form} valid={!!valid} save={() => { void form.save(); }} /><section><h3>Test microphone</h3><p className="field-note">Saved engine: {settings.voiceInput.engine === 'whisper' ? 'Local Whisper' : 'ElevenLabs Scribe'}</p><VoiceButton label="Test microphone" onText={setTest} />{test && <label className="form-field">Test transcript<textarea readOnly value={test} /></label>}</section></div>;
}
