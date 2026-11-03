import { randomUUID } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import { IpcFailure } from '@shared/ipc/errors';
import type { JobInfo } from '@shared/schema/jobs';
import type { ProjectSession } from '@shared/schema/project';
import { managedPath } from '../fs/managed';

export interface JobContext { id: string; project: ProjectSession; signal: AbortSignal; progress: (fraction: number, phase: string, etaSec?: number) => void; log: (text: string) => void }
interface Task { info: JobInfo; project: ProjectSession; controller: AbortController; run: (context: JobContext) => Promise<unknown>; done: Promise<void>; finish: () => void }
export class JobQueue {
  private readonly tasks = new Map<string, Task>(); private closed = false;
  constructor(private readonly onChanged: (jobs: JobInfo[]) => void = () => {}) {}
  list(projectId?: string): JobInfo[] { return structuredClone([...this.tasks.values()].filter((task) => !projectId || task.info.projectId === projectId).map((task) => task.info)); }
  private emit(): void { this.onChanged(this.list()); }
  enqueue(project: ProjectSession, kind: JobInfo['kind'], label: string, run: Task['run']): { jobId: string } {
    if (this.closed) throw new IpcFailure({ code: 'unavailable', message: 'The app is shutting down.' });
    const id = randomUUID(); let finish = (): void => {};
    const task: Task = { project: structuredClone(project), controller: new AbortController(), run, finish: () => finish(), done: new Promise<void>((resolve) => { finish = resolve; }), info: { id, kind, label, projectId: project.project.id, phase: 'Queued', createdAt: new Date().toISOString(), finishedAt: null, status: 'queued', progress: 0, logPath: `work/logs/${id}.log` } };
    this.tasks.set(id, task); this.emit(); queueMicrotask(() => this.pump()); return { jobId: id };
  }
  private pump(): void {
    if (this.closed) return;
    for (const task of this.tasks.values()) {
      if (task.info.status !== 'queued') continue;
      const active = [...this.tasks.values()].filter((other) => other.info.kind === task.info.kind && other.info.status === 'running').length;
      if (active >= (task.info.kind === 'export' ? 1 : 2)) continue;
      task.info.status = 'running'; task.info.phase = 'Preparing'; this.emit(); void this.execute(task);
    }
  }
  private async execute(task: Task): Promise<void> {
    let writes = Promise.resolve(); let writeError: unknown; let bytes = 0;
    try {
      const file = await managedPath(task.project.rootPath, task.info.logPath); await mkdir(path.dirname(file), { recursive: true });
      const log = await open(file, 'wx', 0o600);
      const write = (text: string): void => { const chunk = Buffer.from(text).subarray(0, Math.max(0, 1024 * 1024 - bytes)); bytes += chunk.length; if (chunk.length) writes = writes.then(async () => { if (writeError) return; try { await log.write(chunk); } catch (error) { writeError = error; task.controller.abort(); } }); };
      try {
        write(`${task.info.kind}: ${task.info.label}\n`);
        task.info.result = await task.run({ id: task.info.id, project: task.project, signal: task.controller.signal, log: write, progress: (fraction, phase, etaSec) => {
          if (task.info.status !== 'running' || task.controller.signal.aborted) return;
          task.info.progress = Math.max(task.info.progress, Math.min(0.999, Math.max(0, Number.isFinite(fraction) ? fraction : 0))); task.info.phase = phase;
          if (etaSec !== undefined && Number.isFinite(etaSec)) task.info.etaSec = Math.max(0, etaSec); this.emit();
        } });
        if (task.controller.signal.aborted) throw new Error('Cancelled');
        task.info.status = 'done'; task.info.progress = 1; task.info.phase = 'Finished'; write('Finished\n');
      } finally { try { await writes; await log.sync(); } finally { await log.close(); } }
      if (writeError) throw writeError;
    } catch (error) {
      const cancelled = task.controller.signal.aborted && !writeError;
      task.info.status = cancelled ? 'cancelled' : 'failed'; task.info.phase = cancelled ? 'Cancelled' : 'Failed';
      if (!cancelled) task.info.error = error instanceof IpcFailure ? { code: error.code, message: error.message } : { code: 'internal', message: 'The job could not be completed. Check the job log and tool installation.' };
    } finally { task.info.finishedAt = new Date().toISOString(); task.finish(); this.emit(); this.pump(); }
  }
  async cancel(id: string): Promise<{ ok: true }> {
    const task = this.tasks.get(id); if (!task) throw new IpcFailure({ code: 'not_found', message: 'Job not found.' });
    if (task.info.status === 'queued') { task.controller.abort(); task.info.status = 'cancelled'; task.info.phase = 'Cancelled'; task.info.finishedAt = new Date().toISOString(); task.finish(); this.emit(); }
    else if (task.info.status === 'running') { task.controller.abort(); await task.done; }
    return { ok: true };
  }
  async wait(id: string): Promise<JobInfo> { const task = this.tasks.get(id); if (!task) throw new IpcFailure({ code: 'not_found', message: 'Job not found.' }); await task.done; return structuredClone(task.info); }
  async cancelProject(projectId: string): Promise<void> { await Promise.all([...this.tasks.values()].filter((task) => task.info.projectId === projectId).map((task) => this.cancel(task.info.id))); }
  async close(): Promise<void> { this.closed = true; await Promise.all([...this.tasks.keys()].map((id) => this.cancel(id))); }
}
