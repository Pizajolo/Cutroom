import { CircleAlert, Info } from 'lucide-react';
import type { ReactNode } from 'react';

export function Notice({ children, danger = false, action }: { children: ReactNode; danger?: boolean; action?: ReactNode }) {
  const Icon = danger ? CircleAlert : Info;
  return <div className={`notice${danger ? ' notice-danger' : ''}`} role={danger ? 'alert' : 'status'}>
    <Icon size={16} aria-hidden="true" /><div>{children}</div>{action}
  </div>;
}

export function Unavailable({ title, children }: { title: string; children: ReactNode }) {
  return <section className="empty-state" aria-label={title}><h2>{title}</h2><p>{children}</p></section>;
}
