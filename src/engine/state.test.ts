import {
  mkdir,
  readFile,
  readdir,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STATE_PATH,
  type State,
  emptyState,
  fingerprint,
  loadState,
  matchesFingerprint,
  recordFingerprint,
  recorded,
  removeFingerprint,
  writeState,
} from './state.ts';
import { useTempRoot } from './test-helpers.ts';

const temp = useTempRoot();
const statePath = () => join(temp.dirs.root, DEFAULT_STATE_PATH);
const modeOf = async (path: string) => (await stat(path)).mode & 0o777;

const SECRET = 'correct horse battery staple';

describe('the state', () => {
  it('is empty when the file is missing, with a fresh 32-byte salt', async () => {
    const result = await loadState(statePath());
    expect(result).toMatchObject({
      ok: true,
      exists: false,
      state: { version: 1, fingerprints: {} },
    });
    if (!result.ok) return;
    expect(Buffer.from(result.state.salt, 'base64')).toHaveLength(32);
    expect(emptyState().salt).not.toBe(result.state.salt);
  });

  it('writes atomically with mode 600 in a directory with mode 700', async () => {
    const state = emptyState();
    recordFingerprint(state, '.env', 'KEY', SECRET);
    await writeState(statePath(), state);
    expect(await modeOf(statePath())).toBe(0o600);
    expect(await modeOf(join(temp.dirs.root, '.configure-env'))).toBe(0o700);
    // No temporary file is left behind.
    expect(await readdir(join(temp.dirs.root, '.configure-env'))).toEqual([
      'state.json',
    ]);
    const loaded = await loadState(statePath());
    expect(loaded).toEqual({ ok: true, exists: true, state });
  });

  it('never holds the value, only its HMAC', async () => {
    const state = emptyState();
    recordFingerprint(state, '.env', 'KEY', SECRET);
    await writeState(statePath(), state);
    const text = await readFile(statePath(), 'utf8');
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(Buffer.from(SECRET).toString('base64'));
    expect(text).not.toContain(Buffer.from(SECRET).toString('hex'));
    const entry = recorded(state, '.env', 'KEY')!;
    expect(entry.hmac).toMatch(/^[0-9a-f]{64}$/);
    expect(entry.hmac).toBe(fingerprint(state.salt, SECRET));
    expect(entry.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('keys fingerprints by file and variable, with a salt per state', () => {
    const state = emptyState();
    recordFingerprint(state, '.env', 'KEY', SECRET);
    expect(matchesFingerprint(state, '.env', 'KEY', SECRET)).toBe(true);
    expect(matchesFingerprint(state, '.env', 'KEY', `${SECRET}!`)).toBe(false);
    expect(recorded(state, 'other.env', 'KEY')).toBeUndefined();
    expect(fingerprint(emptyState().salt, SECRET)).not.toBe(
      recorded(state, '.env', 'KEY')!.hmac,
    );
  });

  it('keeps the date of a value recorded again, and drops a removed one', () => {
    const state = emptyState();
    const first = new Date('2026-01-02T03:04:05Z');
    expect(recordFingerprint(state, '.env', 'KEY', SECRET, first)).toBe(true);
    expect(recordFingerprint(state, '.env', 'KEY', SECRET)).toBe(false);
    expect(recorded(state, '.env', 'KEY')!.recordedAt).toBe(
      first.toISOString(),
    );
    expect(removeFingerprint(state, '.env', 'KEY')).toBe(true);
    expect(state.fingerprints).toEqual({});
    expect(removeFingerprint(state, '.env', 'KEY')).toBe(false);
  });

  it('refuses to write or read through a symlink', async () => {
    const elsewhere = join(await temp.another(), 'target.json');
    await writeFile(elsewhere, '{}');
    await mkdir(join(temp.dirs.root, '.configure-env'));
    await symlink(elsewhere, statePath());
    await expect(writeState(statePath(), emptyState())).rejects.toThrow(
      /is a symlink/,
    );
    expect(await readFile(elsewhere, 'utf8')).toBe('{}');
    expect(await loadState(statePath())).toEqual({
      ok: false,
      message: `${statePath()}: is a symlink; refusing to read through it`,
    });
  });

  it.each([
    ['text that is not JSON', 'nope', 'is not valid JSON'],
    ['another version', { version: 2 }, 'version: must be 1'],
    [
      'a short salt',
      { version: 1, salt: 'AAAA', fingerprints: {} },
      'salt: must be 32 bytes in base64',
    ],
    [
      'a bad fingerprint',
      {
        version: 1,
        salt: Buffer.alloc(32).toString('base64'),
        fingerprints: { '.env': { KEY: { hmac: 'xyz', recordedAt: 'x' } } },
      },
      'fingerprints[".env"].KEY.hmac',
    ],
    [
      'an unknown field',
      {
        version: 1,
        salt: Buffer.alloc(32).toString('base64'),
        fingerprints: {},
        values: {},
      },
      'values',
    ],
  ])('rejects %s, naming the path', async (_label, content, message) => {
    await mkdir(join(temp.dirs.root, '.configure-env'));
    await writeFile(
      statePath(),
      typeof content === 'string' ? content : JSON.stringify(content),
    );
    const result = await loadState(statePath());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain(statePath());
    expect(result.message).toContain(message);
  });

  it('round-trips a state with several files', async () => {
    const state: State = emptyState();
    recordFingerprint(state, '.env', 'A', 'one');
    recordFingerprint(state, 'deploy/.env', 'A', 'one');
    await writeState(statePath(), state);
    const loaded = await loadState(statePath());
    expect(loaded.ok && loaded.state).toEqual(state);
    expect(recorded(state, '.env', 'A')!.hmac).toBe(
      recorded(state, 'deploy/.env', 'A')!.hmac,
    );
  });
});
