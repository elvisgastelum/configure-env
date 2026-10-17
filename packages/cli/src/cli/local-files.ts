// The CLI's own files in the project's .configure-env/ folder, beside the
// state: environments.json (the named environments and their tokens) and
// server.json (the running `serve`). Both hold a token: each is written
// mode 600, through a temporary file renamed into place, and the folder's
// .gitignore names them, so they stay out of git even where the root's
// .gitignore does not ignore the folder.

import {
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  DEFAULT_STATE_PATH,
  STATE_GITIGNORE_COMMENT,
  stateIgnoreEntries,
} from '@configure-env/core';

export const ENVIRONMENTS_FILE = 'environments.json';
export const SERVER_FILE = 'server.json';
/** The files this module writes, as the folder's .gitignore names them. */
const PRIVATE_FILES = [ENVIRONMENTS_FILE, SERVER_FILE];

/** The project's .configure-env folder. */
export const localDir = (root: string) =>
  dirname(resolve(root, DEFAULT_STATE_PATH));

/** The path of one of the folder's files. */
export const localFile = (root: string, name: string) =>
  join(localDir(root), name);

/**
 * Adds the private files to the folder's .gitignore: a missing one is
 * written as the state writes it, with them; an existing one gains the lines
 * it lacks. Never writes through a symlink.
 */
async function ignorePrivateFiles(dir: string): Promise<void> {
  const path = join(dir, '.gitignore');
  const stats = await lstat(path).catch(() => undefined);
  if (!stats) {
    const lines = [
      STATE_GITIGNORE_COMMENT,
      ...stateIgnoreEntries(DEFAULT_STATE_PATH),
      ...PRIVATE_FILES,
      '',
    ];
    await writeFile(path, lines.join('\n'), { flag: 'wx' });
    return;
  }
  if (!stats.isFile()) return;
  const text = await readFile(path, 'utf8');
  const lines = new Set(text.split(/\r?\n/).map((line) => line.trim()));
  if (lines.has('*')) return;
  const missing = PRIVATE_FILES.filter(
    (name) => !lines.has(name) && !lines.has(`/${name}`),
  );
  if (!missing.length) return;
  const separator = text === '' || text.endsWith('\n') ? '' : '\n';
  await writeFile(path, `${text}${separator}${missing.join('\n')}\n`);
}

/** Writes `text` to one of the folder's files, mode 600, replacing it whole. */
export async function writeLocalFile(
  root: string,
  name: string,
  text: string,
): Promise<void> {
  const dir = localDir(root);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await ignorePrivateFiles(dir);
  const temporary = join(dir, `.${name}.${randomBytes(6).toString('hex')}`);
  try {
    await writeFile(temporary, text, { mode: 0o600, flag: 'wx' });
    await rename(temporary, join(dir, name));
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

/** One of the folder's files; undefined when it does not exist. */
export async function readLocalFile(
  root: string,
  name: string,
): Promise<string | undefined> {
  try {
    return await readFile(localFile(root, name), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Removes one of the folder's files; a missing one is no error. */
export const removeLocalFile = (root: string, name: string) =>
  rm(localFile(root, name), { force: true });
