// .configure-env/server.json: where a running `serve` of the project
// listens, so the other commands use it instead of starting a server of
// their own. `serve` writes it once it listens (mode 600: it holds the
// token) and removes it when it stops; a crashed one leaves it, and a
// reader then finds its pid dead.

import { z } from 'zod';
import {
  SERVER_FILE,
  readLocalFile,
  removeLocalFile,
  writeLocalFile,
} from './local-files.ts';

const serverFile = z.object({
  url: z.string().min(1),
  pid: z.int().positive(),
  version: z.string(),
  token: z.string().min(1),
});

export type ServerFile = z.output<typeof serverFile>;

export const writeServerFile = (root: string, server: ServerFile) =>
  writeLocalFile(root, SERVER_FILE, `${JSON.stringify(server, null, 2)}\n`);

/** The running serve the file names; undefined when absent or unreadable. */
export async function readServerFile(
  root: string,
): Promise<ServerFile | undefined> {
  try {
    const text = await readLocalFile(root, SERVER_FILE);
    if (text === undefined) return undefined;
    const result = serverFile.safeParse(JSON.parse(text));
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

/** Removes the file when it still names `pid`: another serve may own it now. */
export async function removeServerFile(
  root: string,
  pid: number,
): Promise<void> {
  if ((await readServerFile(root))?.pid === pid)
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
