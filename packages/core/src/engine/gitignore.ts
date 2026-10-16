// Keeps the protected variables' state out of git: init, from the CLI or the
// portal, adds the state directory to the root's .gitignore.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** The .gitignore line that keeps the protected variables' state out of git. */
export const STATE_IGNORE = '.configure-env/';

/** Lines that already ignore the state directory. */
const IGNORES_STATE = new Set([
  '.configure-env',
  '.configure-env/',
  '/.configure-env',
  '/.configure-env/',
]);

/** What ignoreState did: created .gitignore, added the line, or found it. */
export type IgnoreStatus = 'created' | 'added' | 'present';

/**
 * Adds STATE_IGNORE to the root's .gitignore unless a line already ignores
 * the directory; creates the file when it is missing.
 */
export async function ignoreState(root: string): Promise<IgnoreStatus> {
  const path = join(root, '.gitignore');
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await writeFile(path, `${STATE_IGNORE}\n`, { flag: 'wx' });
    return 'created';
  }
  if (text.split(/\r?\n/).some((line) => IGNORES_STATE.has(line.trim())))
    return 'present';
  const separator = text && !text.endsWith('\n') ? '\n' : '';
  await writeFile(path, `${text}${separator}${STATE_IGNORE}\n`);
  return 'added';
}
