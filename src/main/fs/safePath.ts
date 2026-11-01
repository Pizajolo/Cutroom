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
function readonlyPath(root: string, target: string): boolean {
  const first = path.relative(root, target).split(path.sep)[0]?.toLowerCase();
  return (READ_ONLY_DIRS as readonly string[]).includes(first ?? '');
}

export async function resolveInProject(root: string, rel: string, options: ResolveOptions = {}): Promise<string> {
  if (!isProjectPath(rel)) reject('Expected a project-relative path without traversal');
  const realRoot = await realpath(root);
  const target = path.resolve(realRoot, rel);
  if (!inside(realRoot, target)) reject('Path leaves the project');
  if (options.write && !options.allowReadOnlyWrite && readonlyPath(realRoot, target)) reject('Source folders are read-only');

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
  if (options.write && !options.allowReadOnlyWrite && readonlyPath(realRoot, resolved)) reject('Source folders are read-only');
  // Callers must not replace symlinks between resolution and I/O (TOCTOU).
  return resolved;
}
