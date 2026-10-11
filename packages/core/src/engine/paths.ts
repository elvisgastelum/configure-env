// Where a schema file path lands on disk, and whether it is safe to write.
// The schema already rejects absolute paths and `..` segments; this also
// guards against symlinks that lead out of the project root.

import { lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

/** Whether `path` is `root` or inside it; both must be real paths. */
export function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return !(rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel));
}

/** A path for messages: relative to `cwd` when inside it, else absolute. */
export function displayPath(cwd: string, path: string): string {
  const rel = relative(cwd, path);
  return !rel || rel.startsWith('..') || isAbsolute(rel) ? path : rel;
}

export type Target =
  | { ok: true; absolute: string; exists: boolean; mode?: number }
  | { ok: false; message: string };

const codeOf = (error: unknown) => (error as NodeJS.ErrnoException).code;

/** The real path of the nearest existing ancestor of `path`. */
export async function nearestReal(path: string): Promise<string> {
  for (let dir = path; ; dir = dirname(dir)) {
    try {
      return await realpath(dir);
    } catch (error) {
      if (codeOf(error) !== 'ENOENT' || dirname(dir) === dir) throw error;
    }
  }
}

/**
 * Resolves `path` against `realRoot` (a real path) and refuses it when it
 * leaves the root, directly or through a symlinked directory, when it is a
 * symlink itself, or when it is something other than a regular file.
 */
export async function resolveTarget(
  realRoot: string,
  path: string,
): Promise<Target> {
  const absolute = resolve(realRoot, path);
  if (!isInside(realRoot, absolute) || absolute === realRoot)
    return { ok: false, message: 'resolves outside the root' };

  let parent: string;
  try {
    parent = await nearestReal(dirname(absolute));
  } catch (error) {
    return {
      ok: false,
      message: `cannot resolve its directory: ${codeOf(error)}`,
    };
  }
  if (!isInside(realRoot, parent))
    return {
      ok: false,
      message: 'resolves outside the root through a symlink',
    };

  try {
    const stats = await lstat(absolute);
    if (stats.isSymbolicLink())
      return {
        ok: false,
        message: 'is a symlink; refusing to write through it',
      };
    if (!stats.isFile()) return { ok: false, message: 'is not a regular file' };
    return { ok: true, absolute, exists: true, mode: stats.mode & 0o777 };
  } catch (error) {
    if (codeOf(error) === 'ENOENT')
      return { ok: true, absolute, exists: false };
    return { ok: false, message: `cannot read it: ${codeOf(error)}` };
  }
}
