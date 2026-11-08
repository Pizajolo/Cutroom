import { BookOpen, CircleAlert, Download, Film, FolderOpen, House, KeyRound, Settings2 } from 'lucide-react';
import { accountMethodLabel, useAccounts } from '../lib/useAccounts';
import { setupProgress, useModels, useTools } from '../lib/useTools';
import { ProgressBar } from './InstallProgress';
import type { AppInfo } from '../lib/useAppInfo';
import { useNavigation } from '../state/navigation';

const links = [
  { destination: 'home', label: 'Home', Icon: House },
  { destination: 'projects', label: 'Projects', Icon: FolderOpen },
  { destination: 'skills', label: 'Skills', Icon: BookOpen },
] as const;
export function Sidebar({ info }: { info: AppInfo | null }) {
  const destination = useNavigation((s) => s.destination);
  const { data: accounts, error } = useAccounts();
  const { data: tools } = useTools();
  const { data: models } = useModels();
  const claude = accounts?.find((a) => a.provider === 'anthropic');
  const setup = setupProgress(tools, models);
  const openSettings = (section: 'Accounts' | 'Tools') => { useNavigation.getState().setSettingsSection(section); useNavigation.getState().navigate('settings'); };
  const connection = claude?.status === 'connected' ? `Claude connected · ${accountMethodLabel(claude)}` : error ?? 'Connect Claude';
  const progress = setup.failed ? 'Tool setup needs attention' : `Setting up tools…${setup.percent === undefined ? '' : ` ${setup.percent}%`}`;
  return <aside className="sidebar sidebar-collapsed" aria-label="Main navigation">
    <div className="brand" title={info ? `Cutroom ${info.version}` : 'Cutroom'}><Film size={20} aria-hidden="true" /></div>
    <nav aria-label="Main">{links.map(({ destination: target, label, Icon }) => <button type="button" key={target} className="nav-link" title={label} aria-label={label} aria-current={destination === target || target === 'projects' && destination === 'project' ? 'page' : undefined} onClick={() => useNavigation.getState().navigate(target)}><Icon size={18} aria-hidden="true" /></button>)}</nav>
    <div className="sidebar-bottom">
      <button className="nav-link" title="Settings" aria-label="Settings" aria-current={destination === 'settings' ? 'page' : undefined} onClick={() => useNavigation.getState().navigate('settings')}><Settings2 size={18} /></button>
      {(setup.busy || setup.failed) && <button className="nav-link rail-setup" title={progress} aria-label={progress} onClick={() => openSettings('Tools')}>{setup.failed ? <CircleAlert size={18} /> : <Download size={18} />}{setup.busy && <ProgressBar name="Tool setup" percent={setup.percent} text={progress} />}</button>}
      <button className={`nav-link${claude?.status === 'connected' ? ' rail-connected' : ''}`} title={connection} aria-label={connection} onClick={() => openSettings('Accounts')}><KeyRound size={18} /></button>
    </div>
  </aside>;
}
