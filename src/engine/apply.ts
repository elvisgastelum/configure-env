// Writes a plan to disk, one atomic write per file: the content goes to a
// temporary file in the same directory, is flushed, then takes the target's
// place, so a reader never sees half a file. A file whose content is current
// only gets its mode changed, in place.

import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
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
import { isInside, nearestReal } from './paths.ts';
import { type FileAction, type FilePlan, type Plan, loosens } from './plan.ts';

/** The file system calls apply makes that tests replace. */
export interface ApplyFs {
  link: typeof link;
  open: typeof open;
}

export interface ApplyOptions {
  fs?: Partial<ApplyFs>;
  /** Shorthand for `fs.link`. */
  link?: typeof link;
}

// The errors of a file system without hard links: the fallback creates the
// target exclusively instead.
const NO_LINK = new Set(['EPERM', 'ENOTSUP', 'EXDEV', 'ENOSYS']);

export interface ApplyResult {
  path: string;
  action: FileAction;
  /** False when the file should have been written and was not. */
  ok: boolean;
  /** Whether the content was written; a chmod writes none. */
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
  // Containment first: mkdir must never create directories outside the root.
  if (!isInside(root, await nearestReal(dir)))
    throw new Error('resolves outside the root');
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

/**
 * Writes `content` to `target` only when it does not exist yet. A failed
 * write removes the partial file it created, so a retry can create it.
 */
async function createExclusive(target: string, file: FilePlan, fs: ApplyFs) {
  const handle = await fs.open(target, 'wx', file.mode);
  try {
    await handle.writeFile(file.content ?? '', 'utf8');
    await handle.chmod(file.mode);
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(target, { force: true }).catch(() => undefined);
    throw error;
  }
  await handle.close();
}

async function writeFileAtomic(root: string, file: FilePlan, fs: ApplyFs) {
  const target = await checkTarget(root, file);
  const dir = dirname(target);
  const temp = join(
    dir,
    `.${basename(target)}.${randomBytes(6).toString('hex')}.tmp`,
  );
  let handle: FileHandle | undefined;
  let created = false;
  try {
    handle = await fs.open(temp, 'wx', file.mode);
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
      try {
        await fs.link(temp, target);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code ?? '';
        if (!NO_LINK.has(code)) throw error;
        // No hard links here: an exclusive create keeps the no-replace
        // guarantee, at the cost of a reader possibly seeing a partial file.
        await createExclusive(target, file, fs);
      }
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

// Windows has no O_NOFOLLOW; the lstat before the open still refuses a
// symlink there.
const NO_FOLLOW = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);

/**
 * Changes only the permissions of a file the plan found current. It opens
 * the file without following a symlink and changes the open file, so the
 * mode lands on the file that was checked; chmod ignores the umask.
 */
async function chmodFile(root: string, file: FilePlan, fs: ApplyFs) {
  const realDir = await realpath(dirname(file.target));
  if (!isInside(root, realDir)) throw new Error('resolves outside the root');
  const target = join(realDir, basename(file.target));
  const stats = await lstat(target).catch(() => undefined);
  if (!stats?.isFile()) throw new Error('changed since it was planned');
  const handle = await fs.open(target, NO_FOLLOW).catch((error) => {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ELOOP' || code === 'EMLINK')
      throw new Error('changed since it was planned');
    throw error;
  });
  try {
    const now = await handle.stat();
    const current = now.mode & 0o777;
    if (
      !now.isFile() ||
      now.ino !== stats.ino ||
      current !== file.currentMode ||
      loosens(current, file.mode)
    )
      throw new Error('changed since it was planned');
    await handle.chmod(file.mode);
  } finally {
    await handle.close();
  }
}

/**
 * Writes every file the plan creates or updates, and chmods each one whose
 * action is `mode`. A failed file is reported
 * in its result and the rest are still written; a plan with errors writes
 * nothing.
 */
export async function applyPlan(
  plan: Plan,
  options: ApplyOptions = {},
): Promise<ApplyResult[]> {
  const fs: ApplyFs = { link, open, ...options.fs };
  if (options.link) fs.link = options.link;
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
    const write = file.action === 'create' || file.action === 'update';
    if (!write && file.action !== 'mode') {
      results.push({ ...result, ok: true, written: false });
      continue;
    }
    try {
      if (write) await writeFileAtomic(plan.root, file, fs);
      else await chmodFile(plan.root, file, fs);
      results.push({ ...result, ok: true, written: write });
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
