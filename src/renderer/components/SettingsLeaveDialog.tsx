import { useState } from 'react';
import { useSettingsGuard } from '../state/settingsDraft';
import { Dialog } from './Dialog';
import { Notice } from './Notice';
export function SettingsLeaveDialog() {
  const { guard, pending, busy } = useSettingsGuard();
  const [failed, setFailed] = useState(false);
  if (!pending || !guard) return null;
  const close = () => { if (!busy) { setFailed(false); useSettingsGuard.setState({ pending: null }); } };
  const leave = () => { useSettingsGuard.setState({ guard: null, pending: null, busy: false }); pending(); };
  return <Dialog title="Save changes before leaving?" onClose={close} footer={<><button className="button" autoFocus disabled={busy} onClick={close}>Keep editing</button><button className="button" disabled={busy} onClick={() => { guard.discard(); leave(); }}>Discard changes</button><button className="button primary" disabled={busy} onClick={() => { useSettingsGuard.setState({ busy: true }); void guard.save().then((ok) => { if (ok) leave(); else { setFailed(true); useSettingsGuard.setState({ busy: false }); } }); }}>{busy ? 'Saving…' : 'Save changes'}</button></>}><p>Your settings draft hasn't been saved. Review it before saving, including any newly allowed tools or domains.</p><pre className="draft-preview">{JSON.stringify(guard.preview, null, 2)}</pre>{failed && <Notice danger>These settings couldn't be saved. Keep editing to review the errors, or discard this draft.</Notice>}</Dialog>;
}
