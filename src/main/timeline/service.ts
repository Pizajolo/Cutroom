import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { z } from 'zod/v3';
import { IpcFailure } from '@shared/ipc/errors';
import { actorSchema } from '@shared/schema/common';
import { snapshotInfoSchema, type SnapshotInfo, type TimelineState } from '@shared/schema/editor';
import { timelineDocSchema, type TimelineDoc, type TimelineItem } from '@shared/schema/timeline';
import { applyOps, historyOpSchema, opSchema, TimelineError, type HistoryOp } from '@shared/timeline/ops';
import { appendJson, atomicJson, isMissing, managedPath, readManaged, readManagedBytes } from '../fs/managed';
import { completeJournal, inspectJournal, journalCompletion } from './journal';
import { snapshotsToPrune } from './retention';
type SnapshotPolicy = () => { retainDays: number; maxBytes: number };

type Actor = z.infer<typeof actorSchema>;
export interface EditContext { actor: Actor; label: string; requestId?: string; baseRevision?: number; force?: boolean }
export interface TimelineChange extends EditContext { revision: number; doc: TimelineDoc; before: TimelineDoc; paths: string[]; itemIds: string[]; inverse: HistoryOp[] }
const entrySchema = z.object({
  id: z.string(), seq: z.number().int().positive(), at: z.string().datetime(), actor: z.enum(['user', 'agent', 'system']), actorId: actorSchema,
  requestId: z.string().optional(), label: z.string(), ops: z.array(historyOpSchema), inverse: z.array(historyOpSchema), forward: z.array(historyOpSchema), undoIds: z.array(z.string()), redoIds: z.array(z.string()),
}).strict();
type Entry = z.infer<typeof entrySchema>;
const eventFor = (entry: Entry) => ({ type: 'timeline.changed', historyId: entry.id, seq: entry.seq, at: entry.at, actor: entry.actor, actorId: entry.actorId, ...(entry.requestId === undefined ? {} : { requestId: entry.requestId }), label: entry.label });
export const pathsOverlap = (a: string, b: string): boolean => a === '*' || b === '*' || a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`);
const itemMap = (doc: TimelineDoc): Map<string, TimelineItem> => new Map(doc.tracks.flatMap((track) => track.items.map((item) => [item.id, item] as const)));
export class TimelineService {
  private queue: Promise<unknown> = Promise.resolve();
  private entries: Entry[] = [];
  private undoIds: string[] = []; private redoIds: string[] = [];
  private closed = false; private needsRecovery = false;
  private readonly listeners = new Set<(change: TimelineChange) => void>();
  private constructor(readonly root: string, private doc: TimelineDoc, private readonly sourceDurations?: () => Promise<Record<string, number>>, private readonly snapshotPolicy?: SnapshotPolicy) {}
  static async load(root: string, options: { sourceDurations?: () => Promise<Record<string, number>>; onChanged?: (change: TimelineChange) => void; snapshotPolicy?: SnapshotPolicy } = {}): Promise<TimelineService> {
    const service = new TimelineService(root, timelineDocSchema.parse(JSON.parse(await readManaged(root, 'timeline.json'))), options.sourceDurations, options.snapshotPolicy);
    const historyBytes = await readManagedBytes(root, '.cutroom/history.jsonl').catch((error) => { if (isMissing(error)) return Buffer.alloc(0); throw error; });
    const history = inspectJournal(historyBytes);
    service.entries = history.lines.map((line, index) => { const entry = entrySchema.parse(JSON.parse(line)); if (entry.seq !== index + 1) throw new IpcFailure({ code: 'invalid_request', message: 'Timeline history sequence is invalid.' }); return entry; });
    const pendingText = await readManaged(root, '.cutroom/pending-timeline.json').catch((error) => { if (isMissing(error)) return null; throw error; });
    if (pendingText) {
      const pending = z.object({ doc: timelineDocSchema, entry: entrySchema }).strict().parse(JSON.parse(pendingText));
      const recorded = pending.entry.seq === service.entries.length;
      if ((!recorded && pending.entry.seq !== service.entries.length + 1) || (recorded && (!isDeepStrictEqual(pending.entry, service.entries.at(-1)) || !isDeepStrictEqual(pending.doc, service.doc) || history.tail.length > 0))) throw new IpcFailure({ code: 'conflict', message: 'Timeline recovery identity or sequence is invalid. No recovery files were changed.' });
      const historySuffix = history.tail.length ? journalCompletion(history.tail, pending.entry) : null;
      const eventBytes = await readManagedBytes(root, '.cutroom/events.jsonl').catch((error) => { if (isMissing(error)) return Buffer.alloc(0); throw error; }); const events = inspectJournal(eventBytes);
      const event = eventFor(pending.entry); let eventRecorded = false;
      for (const line of events.lines) {
        const value: unknown = JSON.parse(line);
        if (value && typeof value === 'object' && 'historyId' in value && value.historyId === pending.entry.id) {
          if (eventRecorded || !isDeepStrictEqual(value, event)) throw new IpcFailure({ code: 'conflict', message: 'Timeline event recovery identity is invalid. No recovery files were changed.' });
          eventRecorded = true;
        }
      }
      if (eventRecorded && events.tail.length) throw new IpcFailure({ code: 'conflict', message: 'Unexpected data after the pending timeline event. No recovery files were changed.' });
      const eventSuffix = events.tail.length ? journalCompletion(events.tail, event) : null;
      // Validate both journals before changing anything. Repair uses append only, never truncation.
      await atomicJson(root, 'timeline.json', pending.doc); service.doc = pending.doc;
      if (!recorded) { if (historySuffix) await completeJournal(root, '.cutroom/history.jsonl', historyBytes, historySuffix); else await appendJson(root, '.cutroom/history.jsonl', pending.entry); service.entries.push(pending.entry); }
      if (!eventRecorded) { if (eventSuffix) await completeJournal(root, '.cutroom/events.jsonl', eventBytes, eventSuffix); else await service.appendEvent(pending.entry); }
      await rm(await managedPath(root, '.cutroom/pending-timeline.json'));
    } else if (history.tail.length) throw new IpcFailure({ code: 'conflict', message: 'Timeline history is incomplete and has no recovery record. No files were changed.' });
    const latest = service.entries.at(-1); service.undoIds = latest?.undoIds ?? []; service.redoIds = latest?.redoIds ?? [];
    if (options.onChanged) service.listeners.add(options.onChanged);
    return service;
  }
  onChanged(listener: (change: TimelineChange) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  state(): TimelineState { return { doc: structuredClone(this.doc), revision: this.entries.length, canUndo: this.undoIds.length > 0, canRedo: this.redoIds.length > 0 }; }
  history() { return this.entries.map((entry) => ({ id: entry.id, label: entry.label, actor: entry.actorId, createdAt: entry.at, revision: entry.seq })); }
  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    const pending = this.queue.then(() => { if (this.closed || this.needsRecovery) throw new IpcFailure({ code: 'conflict', message: 'The project changed; retry in the current project.' }); return action(); });
    this.queue = pending.catch(() => undefined); return pending;
  }
  private appendEvent(entry: Entry): Promise<void> { return appendJson(this.root, '.cutroom/events.jsonl', eventFor(entry)); }
  private async commit(ops: HistoryOp[], context: EditContext, stacks?: { undoIds: string[]; redoIds: string[] }, publicEdit = false): Promise<TimelineState> {
    if (context.baseRevision !== undefined && context.baseRevision !== this.entries.length) throw new IpcFailure({ code: 'conflict', message: 'The timeline changed. Refresh and retry.', details: { revision: this.entries.length } });
    const before = this.doc;
    let result;
    try { result = applyOps(before, ops, publicEdit ? { sourceDurations: await this.sourceDurations?.() } : {}); }
    catch (error) { if (error instanceof TimelineError) throw new IpcFailure({ code: 'invalid_request', message: error.message, details: { kind: error.code } }); throw error; }
    const prior = itemMap(before); const after = itemMap(result.doc);
    if (publicEdit && context.actor.startsWith('agent:') && !context.force) {
      for (const itemId of result.changed.itemIds) {
        const paths = result.changed.paths.filter((path) => path.startsWith(`items.${itemId}.`)).map((path) => path.slice(`items.${itemId}.`.length));
        const protectedPaths = prior.get(itemId)?.userEdited ?? [];
        if (paths.some((path) => protectedPaths.some((edited) => pathsOverlap(path, edited)))) throw new IpcFailure({ code: 'user_edited', message: 'This property was edited by the user. Ask for permission before changing it.', details: { itemId, paths } });
      }
    }
    if (publicEdit && context.actor === 'user') {
      for (const itemId of result.changed.itemIds) {
        const item = after.get(itemId); if (!item) continue;
        const paths = result.changed.paths.filter((path) => path.startsWith(`items.${itemId}.`)).map((path) => path.slice(`items.${itemId}.`.length));
        item.userEdited = [...new Set([...item.userEdited, ...paths])];
      }
    }
    const id = randomUUID();
    const entry: Entry = { id, seq: this.entries.length + 1, at: new Date().toISOString(), actor: context.actor.startsWith('agent:') ? 'agent' : context.actor as 'user' | 'system', actorId: context.actor, requestId: context.requestId, label: context.label, ops, inverse: result.inverse, forward: applyOps(result.doc, result.inverse).inverse, undoIds: stacks?.undoIds ?? [...this.undoIds, id], redoIds: stacks?.redoIds ?? [] };
    // Recovery record precedes the first visible mutation; timeline itself is always temp+rename.
    try {
      await atomicJson(this.root, '.cutroom/pending-timeline.json', { doc: result.doc, entry });
      await atomicJson(this.root, 'timeline.json', result.doc);
      await appendJson(this.root, '.cutroom/history.jsonl', entry);
      await this.appendEvent(entry);
      await rm(await managedPath(this.root, '.cutroom/pending-timeline.json'));
    } catch (error) { this.needsRecovery = true; throw error; }
    this.doc = result.doc; this.entries.push(entry); this.undoIds = entry.undoIds; this.redoIds = entry.redoIds;
    const change: TimelineChange = { ...context, revision: entry.seq, doc: structuredClone(this.doc), before: structuredClone(before), ...result.changed, inverse: structuredClone(result.inverse) };
    for (const listener of this.listeners) { try { listener(change); } catch { /* Subscribers cannot undo an already durable edit. */ } }
    return this.state();
  }
  apply(ops: readonly z.input<typeof opSchema>[], context: EditContext): Promise<TimelineState> { return this.exclusive(async () => this.commit(z.array(opSchema).min(1).max(1000).parse(ops), context, undefined, true)); }
  applyReview(ops: readonly HistoryOp[], baseRevision: number): Promise<TimelineState> { return this.exclusive(async () => this.commit(z.array(historyOpSchema).min(1).max(1000).parse(ops), { actor: 'user', label: 'Revert assistant changes', baseRevision })); }
  undo(): Promise<TimelineState> { return this.exclusive(async () => { const id = this.undoIds.at(-1); if (!id) return this.state(); const entry = this.entries.find((entry) => entry.id === id)!; return this.commit(entry.inverse, { actor: 'user', label: `Undo ${entry.label}` }, { undoIds: this.undoIds.slice(0, -1), redoIds: [...this.redoIds, id] }); }); }
  redo(): Promise<TimelineState> { return this.exclusive(async () => { const id = this.redoIds.at(-1); if (!id) return this.state(); const entry = this.entries.find((entry) => entry.id === id)!; return this.commit(entry.forward, { actor: 'user', label: `Redo ${entry.label}` }, { undoIds: [...this.undoIds, id], redoIds: this.redoIds.slice(0, -1) }); }); }
  async snapshots(): Promise<SnapshotInfo[]> {
    const folder = await managedPath(this.root, '.cutroom/snapshots');
    const entries = await readdir(folder, { withFileTypes: true }).catch((error) => { if (isMissing(error)) return []; throw error; });
    const values: SnapshotInfo[] = [];
    for (const entry of entries) if (entry.isDirectory() && /^[A-Za-z0-9-]+$/.test(entry.name)) {
      try { values.push(snapshotInfoSchema.parse(JSON.parse(await readManaged(this.root, `.cutroom/snapshots/${entry.name}/snapshot.json`)))); } catch { /* Incomplete snapshots are never offered for restore. */ }
    }
    return values.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  createSnapshot(label: string): Promise<SnapshotInfo> { return this.exclusive(async () => {
    const id = randomUUID(); const folder = `.cutroom/snapshots/${id}`; await mkdir(await managedPath(this.root, folder), { recursive: true, mode: 0o700 });
    const timeline = `${JSON.stringify(this.doc, null, 2)}\n`; const project = await readManaged(this.root, '.cutroom/project.json');
    await atomicJson(this.root, `${folder}/timeline.json`, this.doc); await atomicJson(this.root, `${folder}/project.json`, JSON.parse(project));
    const previous = await this.snapshots();
    const createdAt = new Date(Math.max(Date.now(), Date.parse(previous[0]?.createdAt ?? '1970-01-01') + 1)).toISOString();
    const info: SnapshotInfo = { id, label, revision: this.entries.length, bytes: Buffer.byteLength(timeline) + Buffer.byteLength(project), createdAt };
    await atomicJson(this.root, `${folder}/snapshot.json`, info);
    if (this.snapshotPolicy) for (const removeId of snapshotsToPrune([info, ...previous], this.snapshotPolicy())) await rm(await managedPath(this.root, `.cutroom/snapshots/${removeId}`), { recursive: true });
    return info;
  }); }
  restoreSnapshot(id: string): Promise<TimelineState> { return this.exclusive(async () => {
    const snapshot = (await this.snapshots()).find((entry) => entry.id === id); if (!snapshot) throw new IpcFailure({ code: 'not_found', message: 'Snapshot not found.' });
    const doc = timelineDocSchema.parse(JSON.parse(await readManaged(this.root, `.cutroom/snapshots/${id}/timeline.json`)));
    return this.commit([{ type: 'restoreTimeline', doc }], { actor: 'user', label: `Restore ${snapshot.label}` });
  }); }
  deleteSnapshot(id: string): Promise<{ ok: true }> { return this.exclusive(async () => {
    if (!(await this.snapshots()).some((entry) => entry.id === id)) throw new IpcFailure({ code: 'not_found', message: 'Snapshot not found.' });
    const folder = await managedPath(this.root, `.cutroom/snapshots/${id}`);
    if (!(await stat(folder)).isDirectory()) throw new IpcFailure({ code: 'forbidden', message: 'Invalid snapshot folder.' });
    await rm(folder, { recursive: true }); return { ok: true };
  }); }
  async close(): Promise<void> { this.closed = true; await this.queue; this.listeners.clear(); }
}
