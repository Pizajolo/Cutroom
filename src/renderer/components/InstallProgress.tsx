import { CircleAlert, Clock, Download } from 'lucide-react';
import type { InstallState } from '@shared/schema/media';
import { downloadPercent } from '../lib/useTools';

export function ProgressBar({ name, percent, text }: { name: string; percent?: number; text: string }) {
  return <div className="install-progress" role="progressbar" aria-label={name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={text} data-indeterminate={percent === undefined ? 'true' : undefined}><span style={percent === undefined ? undefined : { width: `${percent}%` }} /></div>;
}
export function InstallProgress({ name, install }: { name: string; install: InstallState }) {
  const percent = downloadPercent(install);
  const bytes = install.total === null ? `${(install.received / 1_000_000).toFixed(1)} MB downloaded` : `${(install.received / 1_000_000).toFixed(1)} / ${(install.total / 1_000_000).toFixed(1)} MB`;
  const label = install.state === 'queued' ? 'Queued' : install.state === 'downloading' ? `Downloading${percent === undefined ? '' : ` ${percent}%`}` : install.state === 'building' ? `Building…${percent === undefined ? '' : ` ${percent}%`}` : install.state === 'verifying' ? 'Verifying checksum' : install.state === 'installing' ? 'Installing' : 'Install failed';
  const Icon = install.state === 'failed' ? CircleAlert : install.state === 'downloading' ? Download : Clock;
  return <div className="install-status"><span className={`tool-status${install.state === 'failed' ? ' tool-checksum_mismatch' : ''}`}><Icon size={14} aria-hidden="true" />{label}</span>
    {install.state !== 'failed' && <ProgressBar name={`${name} ${install.state === 'building' ? 'build' : 'download'}`} percent={percent} text={install.state === 'downloading' ? `${label}; ${bytes}` : label} />}
    {install.state === 'downloading' && <span className="install-meta">{bytes}</span>}
    {install.state === 'failed' && install.error && <span className="install-error">{install.error}</span>}
  </div>;
}
