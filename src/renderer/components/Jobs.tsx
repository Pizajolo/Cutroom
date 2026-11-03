import { useState } from 'react';
import type { JobInfo } from '@shared/schema/jobs';
import { api } from '../lib/api';
import { useJobs } from '../lib/resources';
import { errorMessage } from '../state/navigation';
export function JobProgress({ job, cancelLabel = 'Cancel' }: { job: JobInfo; cancelLabel?: string }) {
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState(false);
  return <div className="job-progress"><strong>{job.label}</strong><span>{job.status === 'queued' ? 'Queued' : job.phase}</span>{job.status === 'running' && (job.progress > 0 ? <progress max={1} value={job.progress} aria-label={`${job.label} progress`} /> : <progress aria-label={`${job.label} working`} />)}<span>{job.status === 'done' ? 'Complete' : job.error?.message}</span>{['running', 'queued'].includes(job.status) && <button className="button" disabled={cancelling} onClick={() => { setCancelling(true); setError(''); void api.invoke('jobs.cancel', { id: job.id }).catch((r: unknown) => { setError(errorMessage(r)); setCancelling(false); }); }}>{cancelling ? 'Stopping…' : cancelLabel}</button>}{error && <p role="alert" className="field-error">{error}</p>}</div>;
}
export function JobsIndicator() {
  const { data, error, retry } = useJobs();
  const [open, setOpen] = useState(false);
  const running = data?.filter((j) => ['queued', 'running'].includes(j.status)).length ?? 0;
  return <div className="jobs-indicator"><button className="button quiet-button" aria-expanded={open} onClick={() => setOpen(!open)}>{running} jobs running</button>{open && <section className="jobs-popover" aria-label="Background jobs"><h2>Jobs</h2>{error && <p className="field-error">{error}<button className="button" onClick={() => { void retry(); }}>Retry</button></p>}{data?.length ? data.map((job) => <JobProgress key={job.id} job={job} />) : <p className="field-note">No jobs yet.</p>}</section>}</div>;
}
