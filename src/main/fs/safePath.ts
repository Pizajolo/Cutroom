import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { READ_ONLY_DIRS } from '../../shared/project/constants';
import { isProjectPath } from '../../shared/project/paths';

export class PathError extends Error {
  readonly code = 'forbidden';
  constructor(message: string) { super(message); this.name = 'PathError'; }
}
export interface ResolveOptions { write?: boolean; allowReadOnlyWrite?: boolean }
const reject = (message: string): never => { throw new PathError(message); };
function inside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === '' || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`));
}
async function readonlyPath(root: string, target: string): Promise<boolean> {
  const parts = path.relative(root, target).split(path.sep);
  const first = parts[0]?.toLowerCase();
  if ((READ_ONLY_DIRS as readonly string[]).includes(first ?? '')) return true;
  // Loose top-level files are source material too, including aliases resolving to them.
  return parts.length === 1 && !!(await lstat(target).catch(() => null))?.isFile();
}

export async function resolveInProject(root: string, rel: string, options: ResolveOptions = {}): Promise<string> {
  if (!isProjectPath(rel)) reject('Expected a project-relative path without traversal');
  const realRoot = await realpath(root);
  const target = path.resolve(realRoot, rel);
  if (!inside(realRoot, target)) reject('Path leaves the project');
  if (options.write && !options.allowReadOnlyWrite && await readonlyPath(realRoot, target)) reject('Source folders are read-only');

  let ancestor = target;
  const suffix: string[] = [];
  for (;;) {
    try {
      // lstat finds dangling symlinks too; realpath must reject them, not treat them as absent.
      await lstat(ancestor);
      break;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) reject('No existing project ancestor');
      suffix.unshift(path.basename(ancestor)); ancestor = parent;
    }
  }
  const realAncestor = await realpath(ancestor);
  const resolved = path.resolve(realAncestor, ...suffix);
  if (!inside(realRoot, realAncestor) || !inside(realRoot, resolved)) reject('Symlink leaves the project');
  if (options.write && !options.allowReadOnlyWrite && await readonlyPath(realRoot, resolved)) reject('Source folders are read-only');
  // Callers must not replace symlinks between resolution and I/O (TOCTOU).
  return resolved;
}
