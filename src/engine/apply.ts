// Writes a plan to disk, one atomic write per file: the content goes to a
// temporary file in the same directory, is flushed, then takes the target's
// place, so a reader never sees half a file.

import { randomBytes } from 'node:crypto';
import {
  type FileHandle,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
} from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { isInside } from './paths.ts';
import type { FileAction, FilePlan, Plan } from './plan.ts';

export interface ApplyResult {
  path: string;
  action: FileAction;
  /** False when the file should have been written and was not. */
  ok: boolean;
  written: boolean;
  /** Why the write failed. */
  error?: string;
}

/** Flushes a directory entry change; not every platform allows it. */
async function syncDirectory(dir: string) {
  try {
    const handle = await open(dir, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Best effort.
  }
}

/** Re-checks the target right before writing: the disk may have changed. */
async function checkTarget(root: string, file: FilePlan): Promise<string> {
  const dir = dirname(file.target);
  await mkdir(dir, { recursive: true });
  const realDir = await realpath(dir);
  if (!isInside(root, realDir)) throw new Error('resolves outside the root');
  const target = join(realDir, basename(file.target));
  if (file.action === 'update') {
    const stats = await lstat(target).catch(() => undefined);
    if (!stats?.isFile() || stats.isSymbolicLink())
      throw new Error('changed since it was planned');
    if ((await readFile(target, 'utf8')) !== file.previous)
      throw new Error('changed since it was planned');
  }
  return target;
}

async function writeFileAtomic(root: string, file: FilePlan) {
  const target = await checkTarget(root, file);
  const dir = dirname(target);
  const temp = join(
    dir,
    `.${basename(target)}.${randomBytes(6).toString('hex')}.tmp`,
  );
  let handle: FileHandle | undefined;
  let created = false;
  try {
    handle = await open(temp, 'wx', file.mode);
    created = true;
    await handle.writeFile(file.content ?? '', 'utf8');
    // The mode given to open is subject to the umask; chmod is not.
    await handle.chmod(file.mode);
    await handle.sync();
    await handle.close();
    handle = undefined;
    if (file.action === 'create') {
      // link fails when the target exists: a file created after planning
      // is never replaced.
      await link(temp, target);
      await rm(temp, { force: true });
    } else {
      await rename(temp, target);
    }
    created = false;
    await syncDirectory(dir);
  } finally {
    await handle?.close().catch(() => undefined);
    if (created) await rm(temp, { force: true }).catch(() => undefined);
  }
}

/**
 * Writes every file the plan creates or updates. A failed file is reported
 * in its result and the rest are still written; a plan with errors writes
 * nothing.
 */
export async function applyPlan(plan: Plan): Promise<ApplyResult[]> {
  if (plan.errors.length) {
    return plan.files.map((file) => ({
      path: file.path,
      action: file.action,
      ok: false,
      written: false,
      error: 'the plan has errors',
    }));
  }
  const results: ApplyResult[] = [];
  for (const file of plan.files) {
    const result = { path: file.path, action: file.action };
    if (file.action !== 'create' && file.action !== 'update') {
      results.push({ ...result, ok: true, written: false });
      continue;
    }
    try {
      await writeFileAtomic(plan.root, file);
      results.push({ ...result, ok: true, written: true });
    } catch (error) {
      results.push({
        ...result,
        ok: false,
        written: false,
        error: (error as Error).message,
      });
    }
  }
  return results;
}
