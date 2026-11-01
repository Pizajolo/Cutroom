import { Bell, CircleAlert, Download, Film, FolderOpen, House, KeyRound, PanelLeftClose, PanelLeftOpen, Settings2, Users } from 'lucide-react';
import { accountMethodLabel, useAccounts } from '../lib/useAccounts';
import { setupProgress, useModels, useTools } from '../lib/useTools';
import { ProgressBar } from './InstallProgress';
import type { AppInfo } from '../lib/useAppInfo';
import { useNavigation, type Destination } from '../state/navigation';

const links = [
  { destination: 'home', label: 'Home', Icon: House },
  { destination: 'projects', label: 'Projects', Icon: FolderOpen },
  { destination: 'teams', label: 'Teams', Icon: Users },
] as const;
export function Sidebar({ info }: { info: AppInfo | null }) {
  const destination = useNavigation((state) => state.destination);
  const collapsed = useNavigation((state) => state.sidebarCollapsed);
  const recent = useNavigation((state) => state.recentProjects);
  const current = useNavigation((state) => state.project);
  const mediaFolder = useNavigation((state) => state.mediaFolder);
  const navigate = useNavigation((state) => state.navigate);
  const openProject = useNavigation((state) => state.openProject);
  const toggleSidebar = useNavigation((state) => state.toggleSidebar);
  const { data: accounts, error: accountsError } = useAccounts();
  const { data: tools } = useTools();
  const { data: models } = useModels();
  const claude = accounts?.find((account) => account.provider === 'anthropic');
  const setup = setupProgress(tools, models);
  const openSettings = (section: 'Accounts' | 'Tools') => { useNavigation.getState().setSettingsSection(section); navigate('settings'); };
  const connectionLabel = claude?.status === 'connected' ? `Claude connected · ${accountMethodLabel(claude)}` : claude?.status === 'invalid' ? 'Claude: key rejected' : claude?.status === 'unreachable' ? "Claude: can't reach service" : accountsError ? 'Check Claude connection' : accounts ? 'Connect Claude' : 'Checking connections…';
  const downloadLabel = setup.failed ? 'Tool setup needs attention' : `Downloading tools…${setup.percent === undefined ? '' : ` ${setup.percent}%`}`;
  const active = (target: Destination) => destination === target || target === 'projects' && (destination === 'project' || destination === 'media');
  return <aside className={`sidebar${collapsed ? ' sidebar-collapsed' : ''}`} aria-label="Main navigation">
    <div className="brand"><Film size={20} strokeWidth={1.75} aria-hidden="true" /><strong className="sidebar-label">Cutroom</strong></div>
    <nav aria-label="Main">
      {links.map(({ destination: target, label, Icon }) => <div key={target}>
        <button type="button" className="nav-link" aria-current={active(target) ? 'page' : undefined} title={label} onClick={() => navigate(target)}>
          <Icon size={18} strokeWidth={1.75} aria-hidden="true" /><span className="sidebar-label">{label}</span>
        </button>
        {target === 'projects' && mediaFolder && <div className="recent-projects sidebar-label"><button type="button" className="recent-project" aria-current={destination === 'media' ? 'page' : undefined} title={mediaFolder.root} onClick={() => navigate('media')}>Folder media</button></div>}
        {target === 'projects' && recent.length > 0 && <div className="recent-projects sidebar-label">
          {recent.slice(0, 5).map((entry) => <button type="button" key={entry.project.id} title={entry.project.name}
            className="recent-project" aria-current={destination === 'project' && current?.project.id === entry.project.id ? 'page' : undefined}
            onClick={() => openProject(entry)}>{entry.project.name}</button>)}
        </div>}
      </div>)}
    </nav>
    <div className="sidebar-bottom">
      <button type="button" className="nav-link" title="Settings" aria-current={destination === 'settings' ? 'page' : undefined} onClick={() => navigate('settings')}>
        <Settings2 size={18} strokeWidth={1.75} aria-hidden="true" /><span className="sidebar-label">Settings</span>
      </button>
      <div className="sidebar-connection"><button type="button" className="nav-link" title={connectionLabel} aria-label={connectionLabel} onClick={() => openSettings('Accounts')}><KeyRound size={16} aria-hidden="true" /><span className="sidebar-label">{connectionLabel}</span></button></div>
      {(setup.busy || setup.failed) && <button type="button" className="nav-link sidebar-download" title={downloadLabel} aria-label={downloadLabel} onClick={() => openSettings('Tools')}>
        {setup.failed ? <CircleAlert size={16} aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}<span className="sidebar-label">{downloadLabel}</span>
        {setup.busy && !setup.failed && <span className="sidebar-label"><ProgressBar name="Tool setup download" percent={setup.percent} text={downloadLabel} /></span>}
      </button>}
      <div className="sidebar-utility">
        <button type="button" className="icon-button" title={collapsed ? 'Expand sidebar (⌘B)' : 'Collapse sidebar (⌘B)'} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={toggleSidebar}>
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
        <button type="button" className="icon-button" aria-label="Notifications unavailable" title="Notifications are not connected in this build" disabled><Bell size={16} /></button>
        <small className="version sidebar-label">{info ? `v${info.version}` : 'Connecting…'}</small>
      </div>
      <div className="jobs-slot sidebar-label" aria-label="Jobs status">Background jobs not connected</div>
    </div>
  </aside>;
}
