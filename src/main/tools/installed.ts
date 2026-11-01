import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod/v3';
import { toolNameSchema, versionSchema } from './manifest';
import { atomicJson, managedDirectory } from './files';

const recordSchema = z.object({
  name: toolNameSchema, version: versionSchema, arch: z.enum(['arm64', 'x64', 'universal']),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), archiveSha256: z.string().regex(/^[a-f0-9]{64}$/),
  verification: z.enum(['pinned', 'upstream']), installedAt: z.string().datetime(),
}).strict();
export type InstalledTool = z.infer<typeof recordSchema>;
const schema = z.object({ version: z.literal(1), records: z.array(recordSchema), checks: z.record(z.object({ lastCheckedAt: z.string().datetime(), latest: versionSchema.nullable() }).strict()) }).strict();
export type InstalledState = z.infer<typeof schema>;
export class InstalledStore {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private readonly home: string) {}
  async read(): Promise<InstalledState> {
    try {
      const file = await open(path.join(this.home, 'tools', 'installed.json'), constants.O_RDONLY | constants.O_NOFOLLOW);
      try { return schema.parse(JSON.parse(await file.readFile('utf8'))); } finally { await file.close(); }
    } catch { return { version: 1, records: [], checks: {} }; }
  }
  update(fn: (state: InstalledState) => void): Promise<void> {
    const operation = this.pending.then(async () => { const state = await this.read(); fn(state); const root = await managedDirectory(this.home, 'tools'); await atomicJson(path.join(root, 'installed.json'), schema.parse(state)); });
    this.pending = operation.catch(() => undefined); return operation;
  }
  async record(record: InstalledTool): Promise<void> { await this.update((state) => { state.records = state.records.filter((old) => old.name !== record.name || old.version !== record.version || old.arch !== record.arch); state.records.push(record); }); }
}
