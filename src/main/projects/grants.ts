import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { FOLDER_GRANT_TTL_MS } from '@shared/schema/project';
import { IpcFailure } from '@shared/ipc/errors';

export type FolderPurpose = 'projectParent' | 'footage' | 'openProject';
export class FolderGrants {
  private readonly grants = new Map<string, { root: string; purpose: FolderPurpose; expiresAt: number }>();
  constructor(private readonly now: () => number = Date.now) {}
  async issue(root: string, purpose: FolderPurpose): Promise<{ grantId: string; displayPath: string }> {
    const canonical = await realpath(root);
    if (!(await stat(canonical)).isDirectory()) throw new IpcFailure({ code: 'invalid_request', message: 'Select a folder.' });
    for (const [id, grant] of this.grants) if (grant.expiresAt <= this.now()) this.grants.delete(id);
    if (this.grants.size >= 100) throw new IpcFailure({ code: 'forbidden', message: 'Too many pending folder selections.' });
    const grantId = randomUUID(); this.grants.set(grantId, { root: canonical, purpose, expiresAt: this.now() + FOLDER_GRANT_TTL_MS });
    return { grantId, displayPath: canonical };
  }
  consume(id: string, purpose: FolderPurpose): string {
    const grant = this.grants.get(id); this.grants.delete(id);
    if (!grant || grant.purpose !== purpose || grant.expiresAt <= this.now()) throw new IpcFailure({ code: 'forbidden', message: 'This folder selection expired or was already used. Choose the folder again.' });
    return grant.root;
  }
  clear(): void { this.grants.clear(); }
}
