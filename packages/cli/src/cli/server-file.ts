// .configure-env/server.json: where a running `serve` of the project
// listens, so the other commands use it instead of starting a server of
// their own. `serve` writes it once it listens (mode 600: it holds the
// token) and removes it when it stops; a crashed one leaves it, and a
// reader then finds its pid dead.

import { lstat } from 'node:fs/promises';
import { z } from 'zod';
import {
  SERVER_FILE,
  localFile,
  readLocalFile,
  removeLocalFile,
  writeLocalFile,
} from './local-files.ts';
import { isLoopback } from './serve.ts';

const serverFile = z.object({
  url: z.string().min(1),
  pid: z.int().positive(),
  version: z.string(),
  token: z.string().min(1),
});

export type ServerFile = z.output<typeof serverFile>;

export const writeServerFile = (root: string, server: ServerFile) =>
  writeLocalFile(root, SERVER_FILE, `${JSON.stringify(server, null, 2)}\n`);

/**
 * Whether only this user could have written the file: a regular file of
 * theirs that nobody else may read or write, as serve writes it. One a
 * clone holds (committed, so mode 644) is not, and could send the run's
 * values to a server of anyone's choosing. Windows keeps no such mode.
 */
async function isOwnPrivateFile(path: string): Promise<boolean> {
  const stats = await lstat(path);
  if (!stats.isFile()) return false;
  if (process.platform === 'win32') return true;
  if ((stats.mode & 0o077) !== 0) return false;
  return process.getuid === undefined || stats.uid === process.getuid();
}

/** The file as written; undefined when absent or not one serve wrote. */
async function parseServerFile(root: string): Promise<ServerFile | undefined> {
  try {
    const text = await readLocalFile(root, SERVER_FILE);
    if (text === undefined) return undefined;
    const result = serverFile.safeParse(JSON.parse(text));
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The running serve the file names, to attach to; undefined when absent,
 * unreadable, not this user's own private file, or naming a server that
 * is not on this machine.
 */
export async function readServerFile(
  root: string,
): Promise<ServerFile | undefined> {
  const file = await parseServerFile(root);
  if (!file) return undefined;
  try {
    if (!(await isOwnPrivateFile(localFile(root, SERVER_FILE))))
      return undefined;
    const url = new URL(file.url);
    return (url.protocol === 'http:' || url.protocol === 'https:') &&
      isLoopback(url.hostname)
      ? file
      : undefined;
  } catch {
    return undefined;
  }
}

/** Removes the file when it still names `pid`: another serve may own it now. */
export async function removeServerFile(
  root: string,
  pid: number,
): Promise<void> {
  if ((await parseServerFile(root))?.pid === pid)
    await removeLocalFile(root, SERVER_FILE);
}

/** Whether a process with this pid runs (one of another user's counts). */
export function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
