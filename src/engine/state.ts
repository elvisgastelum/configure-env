// The state of protected variables on this machine: a salted HMAC of each
// protected value a write command wrote or found, never the value itself.
// It lets a command tell a restored value from a new one after the env file
// that held it was deleted.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  type FileHandle,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { z } from 'zod';
import { VARIABLE_NAME } from '../schema/definition.ts';
import { formatIssuePath } from '../schema/load.ts';

/** Where the state lives, relative to the project root. */
export const DEFAULT_STATE_PATH = '.configure-env/state.json';

export const STATE_VERSION = 1;

/** The bytes of a state's salt. */
export const SALT_BYTES = 32;

const salt = z.string().refine((text) => {
  const bytes = Buffer.from(text, 'base64');
  return bytes.length === SALT_BYTES && bytes.toString('base64') === text;
}, `must be ${SALT_BYTES} bytes in base64`);

const fingerprintEntry = z.strictObject({
  hmac: z.string().regex(/^[0-9a-f]{64}$/, 'must be 64 lowercase hex digits'),
  recordedAt: z.iso.datetime({ message: 'must be an ISO date' }),
});

const stateSchema = z.strictObject({
  version: z.literal(STATE_VERSION, { error: 'must be 1' }),
  salt,
  fingerprints: z.record(
    z.string().min(1),
    z.record(z.string().regex(VARIABLE_NAME), fingerprintEntry),
  ),
});

/** One recorded value: its HMAC and when it was recorded. */
export type Fingerprint = z.output<typeof fingerprintEntry>;

/** Fingerprints by schema file path, then by variable name. */
export type State = z.output<typeof stateSchema>;

export type StateResult =
  { ok: true; state: State; exists: boolean } | { ok: false; message: string };

/** A state with no fingerprint and a new salt, written on first use. */
export const emptyState = (): State => ({
  version: STATE_VERSION,
  salt: randomBytes(SALT_BYTES).toString('base64'),
  fingerprints: {},
});

const codeOf = (error: unknown) =>
  (error as NodeJS.ErrnoException).code ?? String(error);

/**
 * Reads the state at `path`: an empty one when it does not exist. Anything
 * else that is not a valid state is an error naming the path; it is never
 * guessed at or replaced.
 */
export async function loadState(path: string): Promise<StateResult> {
  const fail = (message: string) => ({
    ok: false as const,
    message: `${path}: ${message}`,
  });
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink())
      return fail('is a symlink; refusing to read through it');
    if (!stats.isFile()) return fail('is not a regular file');
  } catch (error) {
    if (codeOf(error) === 'ENOENT')
      return { ok: true, state: emptyState(), exists: false };
    return fail(`cannot read it: ${codeOf(error)}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    return error instanceof SyntaxError
      ? fail('is not valid JSON')
      : fail(`cannot read it: ${codeOf(error)}`);
  }
  const result = stateSchema.safeParse(json);
  if (result.success) return { ok: true, state: result.data, exists: true };
  const [issue] = result.error.issues;
  return fail(`${formatIssuePath(issue!.path)}: ${issue!.message}`);
}

/** The hex HMAC-SHA-256 of `value` under the state's salt. */
export const fingerprint = (salt: string, value: string) =>
  createHmac('sha256', Buffer.from(salt, 'base64'))
    .update(value, 'utf8')
    .digest('hex');

/** The fingerprint recorded for `key` in `file`, if any. */
export const recorded = (
  state: State,
  file: string,
  key: string,
): Fingerprint | undefined =>
  Object.hasOwn(state.fingerprints, file) &&
  Object.hasOwn(state.fingerprints[file]!, key)
    ? state.fingerprints[file]![key]
    : undefined;

/** Whether `value` is the one recorded for `key` in `file`; compared in constant time. */
export function matchesFingerprint(
  state: State,
  file: string,
  key: string,
  value: string,
): boolean {
  const entry = recorded(state, file, key);
  if (!entry) return false;
  const expected = Buffer.from(entry.hmac, 'hex');
  const actual = Buffer.from(fingerprint(state.salt, value), 'hex');
  return timingSafeEqual(expected, actual);
}

/**
 * Records `value` for `key` in `file`. A value already recorded keeps its
 * date. True when the state changed.
 */
export function recordFingerprint(
  state: State,
  file: string,
  key: string,
  value: string,
  now: Date = new Date(),
): boolean {
  if (matchesFingerprint(state, file, key, value)) return false;
  state.fingerprints[file] ??= {};
  state.fingerprints[file][key] = {
    hmac: fingerprint(state.salt, value),
    recordedAt: now.toISOString(),
  };
  return true;
}

/** Forgets `key` in `file`; true when it was recorded. */
export function removeFingerprint(
  state: State,
  file: string,
  key: string,
): boolean {
  if (!recorded(state, file, key)) return false;
  delete state.fingerprints[file]![key];
  if (!Object.keys(state.fingerprints[file]!).length)
    delete state.fingerprints[file];
  return true;
}

/**
 * Writes the state atomically with mode 600: a temporary file in the same
 * directory, flushed, then renamed over it. A new directory gets mode 700.
 * A state path that is a symlink or not a regular file is refused.
 */
export async function writeState(path: string, state: State): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const stats = await lstat(path).catch(() => undefined);
  if (stats?.isSymbolicLink())
    throw new Error(`${path}: is a symlink; refusing to write through it`);
  if (stats && !stats.isFile())
    throw new Error(`${path}: is not a regular file`);
  const temp = join(
    dir,
    `.${basename(path)}.${randomBytes(6).toString('hex')}.tmp`,
  );
  let handle: FileHandle | undefined;
  let created = false;
  try {
    handle = await open(temp, 'wx', 0o600);
    created = true;
    await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`, 'utf8');
    // The mode given to open is subject to the umask; chmod is not.
    await handle.chmod(0o600);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temp, path);
    created = false;
  } finally {
    await handle?.close().catch(() => undefined);
    if (created) await rm(temp, { force: true }).catch(() => undefined);
  }
}
