import { spawn } from 'node:child_process';
import {
  mkdir,
  readFile,
  readdir,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from 'vite-plus/test';
import * as tables from './db-schema.ts';
import {
  DEFAULT_STATE_PATH,
  type State,
  type StateChange,
  StateBusyError,
  applyChanges,
  emptyState,
  fingerprint,
  legacyStatePath,
  loadState,
  matchesFingerprint,
  recordFingerprint,
  recorded,
  recordedDay,
  removeFingerprint,
  stateMigrations,
  stateSchemaVersion,
  updateState,
  withStateTransaction,
  writeState,
} from './state.ts';
import { useTempRoot } from './test-helpers.ts';

const temp = useTempRoot();
const statePath = () => join(temp.dirs.root, DEFAULT_STATE_PATH);
const legacyPath = () => legacyStatePath(statePath());
const stateDir = () => join(temp.dirs.root, '.configure-env');
const modeOf = async (path: string) => (await stat(path)).mode & 0o777;
const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

const SECRET = 'correct horse battery staple';

const record = (
  file: string,
  key: string,
  value: string,
  replace = false,
): StateChange => ({ action: 'record', file, key, value, replace });

/** The state at the path, failing the test when it cannot be read. */
async function loaded(path = statePath()): Promise<State> {
  const result = await loadState(path);
  if (!result.ok) throw new Error(result.message);
  return result.state;
}

/** A raw connection to the database, for what the API does not show. */
function raw<T>(use: (db: Database.Database) => T): T {
  const db = new Database(statePath(), { fileMustExist: true });
  try {
    return use(db);
  } finally {
    db.close();
  }
}

/** A state.json as earlier versions wrote it. */
async function writeLegacy(state: State) {
  await mkdir(stateDir(), { recursive: true });
  await writeFile(legacyPath(), `${JSON.stringify(state, null, 2)}\n`);
}

describe('the state', () => {
  it('is empty when the database is missing, with a fresh 32-byte salt, and creates nothing', async () => {
    const result = await loadState(statePath());
    expect(result).toMatchObject({
      ok: true,
      exists: false,
      state: { version: 1, fingerprints: {} },
    });
    if (!result.ok) return;
    expect(Buffer.from(result.state.salt, 'base64')).toHaveLength(32);
    expect(emptyState().salt).not.toBe(result.state.salt);
    expect(await exists(stateDir())).toBe(false);
  });

  it('writes the database with mode 600 in a directory with mode 700', async () => {
    const state = emptyState();
    recordFingerprint(state, '.env', 'KEY', SECRET);
    await writeState(statePath(), state);
    expect(await modeOf(statePath())).toBe(0o600);
    expect(await modeOf(stateDir())).toBe(0o700);
    expect(await loadState(statePath())).toEqual({
      ok: true,
      exists: true,
      state,
    });
  });

  it('never holds the value, only its HMAC', async () => {
    const state = emptyState();
    recordFingerprint(state, '.env', 'KEY', SECRET);
    await writeState(statePath(), state);
    for (const name of await readdir(stateDir())) {
      const bytes = await readFile(join(stateDir(), name));
      for (const form of [
        SECRET,
        Buffer.from(SECRET).toString('base64'),
        Buffer.from(SECRET).toString('hex'),
      ])
        expect(bytes.includes(form), `${name} holds ${form}`).toBe(false);
    }
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
    const elsewhere = join(await temp.another(), 'target.db');
    await writeFile(elsewhere, '');
    await mkdir(stateDir());
    await symlink(elsewhere, statePath());
    await expect(writeState(statePath(), emptyState())).rejects.toThrow(
      /is a symlink/,
    );
    expect(await readFile(elsewhere, 'utf8')).toBe('');
    expect(await loadState(statePath())).toEqual({
      ok: false,
      message: `${statePath()}: is a symlink; refusing to use it`,
    });
  });

  it('rejects a file that is not a SQLite database, naming the path', async () => {
    await mkdir(stateDir());
    await writeFile(statePath(), 'not a database, but long enough to look at');
    expect(await loadState(statePath())).toEqual({
      ok: false,
      message: `${statePath()}: is not a valid state database`,
    });
    await expect(writeState(statePath(), emptyState())).rejects.toThrow(
      `${statePath()}: is not a valid state database`,
    );
  });

  it('round-trips a state with several files', async () => {
    const state: State = emptyState();
    recordFingerprint(state, '.env', 'A', 'one');
    recordFingerprint(state, 'deploy/.env', 'A', 'one');
    await writeState(statePath(), state);
    expect(await loaded()).toEqual(state);
    expect(recorded(state, '.env', 'A')!.hmac).toBe(
      recorded(state, 'deploy/.env', 'A')!.hmac,
    );
  });
});

describe('migrations', () => {
  it('ship with the package and create the tables the schema declares', async () => {
    expect(stateMigrations().length).toBeGreaterThan(0);
    await writeState(statePath(), emptyState());
    raw((db) => {
      for (const table of [
        tables.meta,
        tables.protectedFingerprints,
        tables.changes,
      ]) {
        const config = getTableConfig(table);
        const columns = (
          db.prepare(`pragma table_info(${config.name})`).all() as {
            name: string;
          }[]
        ).map((column) => column.name);
        expect(columns.sort(), config.name).toEqual(
          config.columns.map((column) => column.name).sort(),
        );
      }
      expect(
        db.prepare("select value from meta where key = 'schema_version'").get(),
      ).toEqual({ value: String(stateSchemaVersion()) });
      expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    });
  });

  it('run once: reopening a migrated database changes nothing', async () => {
    const state = emptyState();
    recordFingerprint(state, '.env', 'KEY', SECRET);
    await writeState(statePath(), state);
    await updateState(statePath(), [record('.env', 'OTHER', 'x')]);
    expect(Object.keys((await loaded()).fingerprints['.env']!).sort()).toEqual([
      'KEY',
      'OTHER',
    ]);
  });

  it('migrate an empty database file on its first read', async () => {
    await mkdir(stateDir());
    await writeFile(statePath(), '');
    expect(await loadState(statePath())).toMatchObject({
      ok: true,
      exists: false,
    });
    expect(
      raw((db) =>
        db.prepare("select value from meta where key = 'schema_version'").get(),
      ),
    ).toEqual({ value: String(stateSchemaVersion()) });
  });

  it('refuse a database of a newer version, changing nothing', async () => {
    await writeState(statePath(), emptyState());
    const newer = stateSchemaVersion() + 1;
    raw((db) =>
      db
        .prepare("update meta set value = ? where key = 'schema_version'")
        .run(String(newer)),
    );
    const message = `${statePath()}: has schema version ${newer}, newer than this configure-env knows (${stateSchemaVersion()}); upgrade configure-env`;
    expect(await loadState(statePath())).toEqual({ ok: false, message });
    await expect(
      updateState(statePath(), [record('.env', 'KEY', SECRET)]),
    ).rejects.toThrow(message);
  });

  it('check the actor of the history', async () => {
    await writeState(statePath(), emptyState());
    raw((db) => {
      const insert = db.prepare(
        'insert into changes (actor, file, key, operation, after_fingerprint, after_preview, at) values (?, ?, ?, ?, ?, ?, ?)',
      );
      insert.run('portal', '.env', 'KEY', 'set', 'f'.repeat(64), 'ab…', 'now');
      expect(() =>
        insert.run('someone', '.env', 'KEY', 'set', null, null, 'now'),
      ).toThrow(/CHECK constraint failed/);
    });
  });
});

describe('importing state.json', () => {
  const legacyState = () => {
    const state = emptyState();
    recordFingerprint(state, '.env', 'KEY', SECRET, new Date('2026-01-02'));
    recordFingerprint(state, 'worker.env', 'KEY', 'other');
    return state;
  };

  it('reads it while no database exists, writing nothing', async () => {
    const state = legacyState();
    await writeLegacy(state);
    expect(await loadState(statePath())).toEqual({
      ok: true,
      exists: true,
      state,
    });
    expect(await exists(statePath())).toBe(false);
    expect(await exists(legacyPath())).toBe(true);
  });

  it('imports it on the first write, verifies it, then removes it', async () => {
    const state = legacyState();
    await writeLegacy(state);
    await updateState(statePath(), [record('.env', 'NEW', 'value')]);
    expect(await exists(legacyPath())).toBe(false);
    const now = await loaded();
    expect(now.salt).toBe(state.salt);
    expect(now.fingerprints['worker.env']).toEqual(
      state.fingerprints['worker.env'],
    );
    expect(now.fingerprints['.env']!.KEY).toEqual(
      state.fingerprints['.env']!.KEY,
    );
    expect(matchesFingerprint(now, '.env', 'NEW', 'value')).toBe(true);
  });

  it('keeps it, and imports nothing, when the transaction fails; a retry imports it', async () => {
    const state = legacyState();
    await writeLegacy(state);
    await expect(
      withStateTransaction(statePath(), () => {
        throw new Error('crashed');
      }),
    ).rejects.toThrow('crashed');
    expect(await exists(legacyPath())).toBe(true);
    // Rolled back with the migration that came with it.
    expect(
      raw((db) => db.prepare('select name from sqlite_master').all()),
    ).toEqual([]);
    expect(await loaded()).toEqual(state);
    expect(await exists(legacyPath())).toBe(false);
  });

  it('finishes an import that committed before the file was removed', async () => {
    const state = legacyState();
    // A run imported it, then crashed before removing it; the next run
    // records a key.
    await writeState(statePath(), state);
    await writeLegacy(state);
    await updateState(statePath(), [record('.env', 'LATER', 'x')]);
    expect(await exists(legacyPath())).toBe(false);
    const now = await loaded();
    expect(now.salt).toBe(state.salt);
    expect(Object.keys(now.fingerprints['.env']!).sort()).toEqual([
      'KEY',
      'LATER',
    ]);
    expect(now.fingerprints['worker.env']).toEqual(
      state.fingerprints['worker.env'],
    );
  });

  it('refuses one whose salt differs from the database, removing nothing', async () => {
    await writeState(statePath(), emptyState());
    await writeLegacy(legacyState());
    await expect(
      updateState(statePath(), [record('.env', 'KEY', SECRET)]),
    ).rejects.toThrow(
      `${legacyPath()}: its salt differs from the one in ${statePath()}; remove one of them`,
    );
    expect(await exists(legacyPath())).toBe(true);
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
  ])(
    'rejects %s, naming it, and keeps it',
    async (_label, content, message) => {
      await mkdir(stateDir());
      const text =
        typeof content === 'string' ? content : JSON.stringify(content);
      await writeFile(legacyPath(), text);
      const result = await loadState(statePath());
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.message).toContain(legacyPath());
      expect(result.message).toContain(message);
      await expect(
        updateState(statePath(), [record('.env', 'KEY', SECRET)]),
      ).rejects.toThrow(message);
      expect(await readFile(legacyPath(), 'utf8')).toBe(text);
    },
  );
});

describe('applyChanges', () => {
  it('records a value only where none is recorded, unless it replaces', () => {
    const state = emptyState();
    recordFingerprint(state, '.env', 'KEY', 'old', new Date('2026-01-01'));
    expect(applyChanges(state, [record('.env', 'KEY', 'edited')])).toBe(false);
    expect(matchesFingerprint(state, '.env', 'KEY', 'old')).toBe(true);
    expect(applyChanges(state, [record('.env', 'KEY', 'new', true)])).toBe(
      true,
    );
    expect(matchesFingerprint(state, '.env', 'KEY', 'new')).toBe(true);
    expect(
      applyChanges(state, [{ action: 'remove', file: '.env', key: 'KEY' }]),
    ).toBe(true);
    expect(state.fingerprints).toEqual({});
  });
});

const TSX = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
const STATE_MODULE = pathToFileURL(
  fileURLToPath(new URL('./state.ts', import.meta.url)),
).href;

/** Runs `code` in a new Node process with the state module as `state`. */
async function child(code: string): Promise<{ code: number; err: string }> {
  const script = join(await temp.another(), 'child.mjs');
  await writeFile(
    script,
    `import * as state from ${JSON.stringify(STATE_MODULE)};\n${code}\n`,
  );
  const proc = spawn(process.execPath, ['--import', TSX, script], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let err = '';
  proc.stderr.on('data', (chunk: Buffer) => (err += chunk));
  const status = await new Promise<number>((done) =>
    proc.on('close', (status) => done(status ?? -1)),
  );
  return { code: status, err };
}

describe('updateState', () => {
  it('keeps the fingerprints of two runs that both loaded an empty state', async () => {
    await Promise.all([
      updateState(statePath(), [record('.env', 'A', 'one')]),
      updateState(statePath(), [record('worker.env', 'B', 'two')]),
    ]);
    const state = await loaded();
    expect(matchesFingerprint(state, '.env', 'A', 'one')).toBe(true);
    expect(matchesFingerprint(state, 'worker.env', 'B', 'two')).toBe(true);
  });

  it('keeps the salt and the entries on disk, applying only its changes', async () => {
    const disk = emptyState();
    recordFingerprint(disk, '.env', 'OTHER', 'kept');
    recordFingerprint(disk, '.env', 'GONE', 'removed');
    await writeState(statePath(), disk);
    expect(
      await updateState(statePath(), [
        record('.env', 'KEY', SECRET),
        { action: 'remove', file: '.env', key: 'GONE' },
      ]),
    ).toBe(true);
    const state = await loaded();
    expect(state.salt).toBe(disk.salt);
    expect(Object.keys(state.fingerprints['.env']!).sort()).toEqual([
      'KEY',
      'OTHER',
    ]);
    expect(matchesFingerprint(state, '.env', 'KEY', SECRET)).toBe(true);
  });

  it('writes nothing when the changes change nothing', async () => {
    expect(await updateState(statePath(), [])).toBe(false);
    expect(await exists(statePath())).toBe(false);
    expect(
      await updateState(statePath(), [
        { action: 'remove', file: '.env', key: 'KEY' },
      ]),
    ).toBe(false);
    expect(await loadState(statePath())).toMatchObject({
      ok: true,
      exists: false,
    });
  });

  it('lets simultaneous runs of this process write in turn', async () => {
    const keys = ['A', 'B', 'C', 'D', 'E', 'F'];
    await Promise.all(
      keys.map((key) => updateState(statePath(), [record('.env', key, key)])),
    );
    const state = await loaded();
    for (const key of keys)
      expect(matchesFingerprint(state, '.env', key, key)).toBe(true);
  });

  it('lets concurrent processes write in turn, losing no fingerprint', async () => {
    const path = JSON.stringify(statePath());
    const runs = await Promise.all(
      ['A', 'B', 'C', 'D'].map((name) =>
        child(`
          for (let i = 0; i < 5; i++)
            await state.updateState(${path}, [
              { action: 'record', file: '.env', key: '${name}' + i, value: 'v' + i, replace: false },
            ], { waitMs: 10_000 });
        `),
      ),
    );
    expect(runs).toEqual(runs.map(() => ({ code: 0, err: '' })));
    const state = await loaded();
    expect(Object.keys(state.fingerprints['.env']!)).toHaveLength(20);
  }, 30_000);

  describe('a write transaction held by another run', () => {
    /** Holds the write lock from another connection until released. */
    async function hold() {
      await writeState(statePath(), emptyState());
      const db = new Database(statePath());
      db.exec('BEGIN IMMEDIATE');
      return () => {
        db.exec('COMMIT');
        db.close();
      };
    }

    it('is waited for, then refused, writing nothing', async () => {
      const release = await hold();
      try {
        const attempt = updateState(
          statePath(),
          [record('.env', 'KEY', SECRET)],
          { waitMs: 100 },
        );
        await expect(attempt).rejects.toThrow(StateBusyError);
        await expect(attempt).rejects.toThrow(
          `${statePath()}: in use by another run; try again`,
        );
      } finally {
        release();
      }
      expect((await loaded()).fingerprints).toEqual({});
    });

    it('lets readers read meanwhile', async () => {
      const release = await hold();
      try {
        expect(await loadState(statePath())).toMatchObject({ ok: true });
      } finally {
        release();
      }
    });

    it('is taken once it is released', async () => {
      const release = await hold();
      setTimeout(release, 150);
      expect(
        await updateState(statePath(), [record('.env', 'KEY', SECRET)], {
          waitMs: 5_000,
        }),
      ).toBe(true);
      expect(matchesFingerprint(await loaded(), '.env', 'KEY', SECRET)).toBe(
        true,
      );
    });
  });

  it('is released when the process holding it dies, with nothing to remove by hand', async () => {
    await writeState(statePath(), emptyState());
    const path = JSON.stringify(statePath());
    const died = await child(`
      await state.withStateTransaction(${path}, (tx) => {
        tx.state.fingerprints['.env'] = { KEY: { hmac: '0'.repeat(64), recordedAt: new Date().toISOString() } };
        tx.write(tx.state);
        process.exit(3);
      });
    `);
    expect(died.code).toBe(3);
    expect((await loaded()).fingerprints).toEqual({});
    expect(
      await updateState(statePath(), [record('.env', 'KEY', SECRET)], {
        waitMs: 100,
      }),
    ).toBe(true);
  }, 15_000);

  it('writes through the given writer, keeping the state on disk when it fails', async () => {
    const disk = emptyState();
    await writeState(statePath(), disk);
    await expect(
      updateState(statePath(), [record('.env', 'KEY', SECRET)], {
        write: async () => {
          throw new Error('disk full');
        },
      }),
    ).rejects.toThrow('disk full');
    expect(await loaded()).toEqual(disk);
  });
});

describe('recordedDay', () => {
  // Zones on both sides of UTC: a local-time date would differ in one.
  it.each(['Pacific/Kiritimati', 'America/Adak'])(
    'gives the UTC day in %s',
    (zone) => {
      const saved = process.env.TZ;
      process.env.TZ = zone;
      try {
        const late = '2020-01-02T23:59:30.000Z';
        const early = '2020-01-03T00:00:30.000Z';
        // The zone took effect: one of the two local days differs.
        const local = [late, early].map((at) => new Date(at).getDate());
        expect(local).not.toEqual([2, 3]);
        expect(recordedDay(late)).toBe('2020-01-02');
        expect(recordedDay(early)).toBe('2020-01-03');
      } finally {
        if (saved === undefined) delete process.env.TZ;
        else process.env.TZ = saved;
      }
    },
  );
});
