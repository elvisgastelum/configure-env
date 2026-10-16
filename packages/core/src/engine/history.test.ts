import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import type { VariableSpec } from '../schema/definition.ts';
import {
  LEGACY_UNDO_REASON,
  SCHEMA_CREATE_UNDO_REASON,
  SECRET_UNDO_REASON,
  UNDECLARED_UNDO_REASON,
  SECRET_PREVIEW,
  queryChanges,
  readChange,
  isSecretChange,
  readChanges,
  recordChanges,
  undoBlocker,
} from './history.ts';
import { schemaFingerprint } from '../writer/store.ts';
import {
  DEFAULT_STATE_PATH,
  fingerprint,
  loadState,
  stateSchemaVersion,
} from './state.ts';
import { useTempRoot, writeV1State } from './test-helpers.ts';

const temp = useTempRoot();
const statePath = () => join(temp.dirs.root, DEFAULT_STATE_PATH);
const plain: VariableSpec = { type: 'string', required: false, secret: false };
const secret: VariableSpec = { ...plain, secret: true };
const AT = new Date('2026-01-02T03:04:05.000Z');

/**
 * The database's bytes, as a hash, and those of its WAL: SQLite may leave an
 * empty WAL and its index next to a database it opened read-only.
 */
async function snapshot(path: string) {
  const wal = await readFile(`${path}-wal`).catch(() => Buffer.alloc(0));
  return {
    db: createHash('sha256')
      .update(await readFile(path))
      .digest('hex'),
    wal: wal.length,
  };
}

/** The database's schema version, read as a version-1 reader would. */
function schemaVersionOf(path: string): string | undefined {
  const sqlite = new Database(path, { readonly: true, fileMustExist: true });
  try {
    sqlite
      .prepare(
        'select id, actor, file, key, operation, before_fingerprint, after_fingerprint, before_preview, after_preview, at from changes',
      )
      .all();
    return (
      sqlite
        .prepare("select value from meta where key = 'schema_version'")
        .get() as { value: string } | undefined
    )?.value;
  } finally {
    sqlite.close();
  }
}

describe('recordChanges', () => {
  it('records fingerprints and masked previews, never a secret', async () => {
    await recordChanges(
      statePath(),
      'portal',
      [
        {
          file: '.env',
          key: 'TOKEN',
          operation: 'replace',
          spec: secret,
          before: 'old-secret-value',
          after: 'new-secret-value',
        },
        {
          file: '.env',
          key: 'NAME',
          operation: 'unset',
          spec: plain,
          before: 'app',
        },
      ],
      AT,
    );
    const state = await loadState(statePath());
    if (!state.ok) throw new Error(state.message);
    const { salt } = state.state;
    expect(await readChanges(statePath())).toEqual([
      {
        id: 1,
        actor: 'portal',
        file: '.env',
        key: 'TOKEN',
        operation: 'replace',
        beforeFingerprint: fingerprint(salt, 'old-secret-value'),
        afterFingerprint: fingerprint(salt, 'new-secret-value'),
        beforePreview: '••••',
        afterPreview: '••••',
        at: AT.toISOString(),
        beforeValue: null,
        afterValue: null,
        restorable: false,
        undoOf: null,
        notKept: 'secret',
      },
      {
        id: 2,
        actor: 'portal',
        file: '.env',
        key: 'NAME',
        operation: 'unset',
        beforeFingerprint: fingerprint(salt, 'app'),
        afterFingerprint: null,
        beforePreview: 'app',
        afterPreview: null,
        at: AT.toISOString(),
        beforeValue: 'app',
        afterValue: null,
        restorable: true,
        undoOf: null,
        notKept: null,
      },
    ]);
    const sqlite = new Database(statePath(), { readonly: true });
    const dump = JSON.stringify(sqlite.prepare('select * from changes').all());
    sqlite.close();
    expect(dump).not.toContain('secret-value');
  });

  it('keeps the salt the state already has', async () => {
    await recordChanges(statePath(), 'cli', [
      { file: '.env', key: 'A', operation: 'set', spec: plain, after: 'x' },
    ]);
    const first = await loadState(statePath());
    await recordChanges(statePath(), 'cli', [
      { file: '.env', key: 'A', operation: 'set', spec: plain, after: 'y' },
    ]);
    const second = await loadState(statePath());
    expect(first.ok && second.ok && first.state.salt).toBe(
      second.ok && second.state.salt,
    );
    expect((await readChanges(statePath())).map((row) => row.id)).toEqual([
      1, 2,
    ]);
  });

  it('shortens a long preview', async () => {
    await recordChanges(statePath(), 'portal', [
      {
        file: '.env',
        key: 'A',
        operation: 'set',
        spec: plain,
        after: 'x'.repeat(100),
      },
    ]);
    const [row] = await readChanges(statePath());
    expect(row!.afterPreview).toBe(`${'x'.repeat(63)}…`);
  });

  it('keeps the values of a variable that is not secret, so it can be undone', async () => {
    const ids = await recordChanges(statePath(), 'cli', [
      {
        file: '.env',
        key: 'NAME',
        operation: 'set',
        spec: plain,
        before: 'old',
        after: 'new',
      },
    ]);
    expect(ids).toEqual([1]);
    expect(await readChange(statePath(), 1)).toMatchObject({
      actor: 'cli',
      beforeValue: 'old',
      afterValue: 'new',
      restorable: true,
    });
  });

  it('records a schema write with its text, and says a creation is not undone', async () => {
    const before = '{"version":1,"variables":{},"files":[]}';
    const after =
      '{"version":1,"variables":{"A":{"type":"string"}},"files":[]}';
    expect(
      await recordChanges(
        statePath(),
        'portal',
        [
          { file: 'env.schema.json', operation: 'schema', after: before },
          { file: 'env.schema.json', operation: 'schema', before, after },
        ],
        AT,
      ),
    ).toEqual([1, 2]);
    const [created, edited] = await readChanges(statePath());
    expect(created).toMatchObject({
      key: '',
      operation: 'schema',
      beforeFingerprint: null,
      afterFingerprint: schemaFingerprint(before),
      beforePreview: null,
      afterPreview: '0 variables, 0 files',
      beforeValue: null,
      afterValue: before,
      restorable: false,
    });
    expect(undoBlocker(created!)).toBe(SCHEMA_CREATE_UNDO_REASON);
    expect(edited).toMatchObject({
      beforeFingerprint: schemaFingerprint(before),
      afterFingerprint: schemaFingerprint(after),
      beforePreview: '0 variables, 0 files',
      afterPreview: '1 variable, 0 files',
      beforeValue: before,
      afterValue: after,
      restorable: true,
    });
    expect(undoBlocker(edited!)).toBeUndefined();
  });

  it('keeps no value of a key the schema does not declare, and says why', async () => {
    const stray = ['stray', 'v'.repeat(70)].join('-');
    await recordChanges(statePath(), 'cli', [
      {
        file: '.env',
        key: 'STRAY',
        operation: 'unset',
        spec: plain,
        undeclared: true,
        before: stray,
      },
    ]);
    const row = (await readChange(statePath(), 1))!;
    expect(row).toMatchObject({
      beforePreview: '••••',
      beforeValue: null,
      restorable: false,
      notKept: 'undeclared',
    });
    expect(undoBlocker(row)).toBe(UNDECLARED_UNDO_REASON);
    const sqlite = new Database(statePath(), { readonly: true });
    const dump = JSON.stringify(sqlite.prepare('select * from changes').all());
    sqlite.close();
    expect(dump).not.toContain('stray-');
  });

  it("says a secret's change cannot be undone", async () => {
    await recordChanges(statePath(), 'cli', [
      {
        file: '.env',
        key: 'TOKEN',
        operation: 'set',
        spec: secret,
        after: 'some-secret-value',
      },
    ]);
    expect(undoBlocker((await readChange(statePath(), 1))!)).toBe(
      SECRET_UNDO_REASON,
    );
  });

  it('writes nothing for no change', async () => {
    await recordChanges(statePath(), 'portal', []);
    expect(await readChanges(statePath())).toEqual([]);
  });
});

describe('queryChanges', () => {
  const at = (day: number) => new Date(`2026-01-0${day}T12:00:00.000Z`);
  const set = (file: string, key: string) => ({
    file,
    key,
    operation: 'set' as const,
    spec: plain,
    after: 'x',
  });

  it('is empty without a database', async () => {
    expect(await queryChanges(statePath())).toEqual({
      changes: [],
      total: 0,
      page: 1,
      limit: 50,
    });
  });

  it('filters by file, key, actor and date, newest first, one page at a time', async () => {
    await recordChanges(statePath(), 'cli', [set('.env', 'A')], at(1));
    await recordChanges(statePath(), 'portal', [set('.env', 'B')], at(2));
    await recordChanges(statePath(), 'portal', [set('app.env', 'A')], at(3));
    await recordChanges(statePath(), 'cli', [set('.env', 'A')], at(4));
    const ids = async (filter: Parameters<typeof queryChanges>[1]) =>
      (await queryChanges(statePath(), filter)).changes.map((row) => row.id);
    expect(await ids({})).toEqual([4, 3, 2, 1]);
    expect(await ids({ file: '.env' })).toEqual([4, 2, 1]);
    expect(await ids({ key: 'A' })).toEqual([4, 3, 1]);
    expect(await ids({ actor: 'portal' })).toEqual([3, 2]);
    expect(await ids({ from: '2026-01-02', to: '2026-01-03' })).toEqual([3, 2]);
    expect(await ids({ to: '2026-01-02T00:00:00.000Z' })).toEqual([1]);
    expect(
      await queryChanges(statePath(), { limit: 3, page: 2 }),
    ).toMatchObject({ total: 4, page: 2, limit: 3, changes: [{ id: 1 }] });
    expect(
      await queryChanges(statePath(), { file: '.env', key: 'A', limit: 1 }),
    ).toMatchObject({ total: 2, changes: [{ id: 4 }] });
  });

  it('reads a database an older version wrote without upgrading it', async () => {
    await writeV1State(statePath(), [
      {
        actor: 'cli',
        file: '.env',
        key: 'A',
        operation: 'set',
        beforePreview: 'old',
        afterPreview: 'new',
        at: at(1).toISOString(),
      },
      {
        actor: 'portal',
        file: 'app.env',
        key: 'B',
        operation: 'unset',
        beforePreview: 'gone',
        at: at(2).toISOString(),
      },
    ]);
    const before = await snapshot(statePath());
    const { changes, total } = await queryChanges(statePath(), {
      file: '.env',
    });
    expect(total).toBe(1);
    expect(changes).toEqual([
      {
        id: 1,
        actor: 'cli',
        file: '.env',
        key: 'A',
        operation: 'set',
        beforeFingerprint: 'a'.repeat(64),
        afterFingerprint: 'b'.repeat(64),
        beforePreview: 'old',
        afterPreview: 'new',
        at: at(1).toISOString(),
        beforeValue: null,
        afterValue: null,
        restorable: false,
        undoOf: null,
        notKept: null,
      },
    ]);
    expect(undoBlocker(changes[0]!)).toBe(LEGACY_UNDO_REASON);
    expect((await readChanges(statePath())).map((row) => row.id)).toEqual([
      1, 2,
    ]);
    expect(await readChange(statePath(), 2)).toMatchObject({
      key: 'B',
      restorable: false,
      notKept: null,
    });
    expect(await snapshot(statePath())).toEqual(before);
    expect(schemaVersionOf(statePath())).toBe('1');
  });

  it('refuses to read a database of a newer version, changing nothing', async () => {
    await recordChanges(statePath(), 'cli', [set('.env', 'A')], at(1));
    const newer = stateSchemaVersion() + 1;
    const sqlite = new Database(statePath());
    sqlite
      .prepare("update meta set value = ? where key = 'schema_version'")
      .run(String(newer));
    sqlite.close();
    const before = await snapshot(statePath());
    const message = `${statePath()}: has schema version ${newer}, newer than this configure-env knows (${stateSchemaVersion()}); upgrade configure-env`;
    await expect(queryChanges(statePath())).rejects.toThrow(message);
    await expect(readChanges(statePath())).rejects.toThrow(message);
    expect(await snapshot(statePath())).toEqual(before);
  });

  it('upgrades a database an older version wrote when it records a change', async () => {
    await writeV1State(statePath(), [
      {
        actor: 'cli',
        file: '.env',
        key: 'A',
        operation: 'set',
        afterPreview: 'old',
        at: at(1).toISOString(),
      },
    ]);
    await recordChanges(statePath(), 'cli', [set('.env', 'A')], at(2));
    expect(schemaVersionOf(statePath())).toBe(String(stateSchemaVersion()));
    expect(await readChanges(statePath())).toMatchObject([
      { id: 1, restorable: false },
      { id: 2, restorable: true },
    ]);
  });

  it("says a secret's change an older version recorded is a secret's", async () => {
    await writeV1State(statePath(), [
      {
        actor: 'cli',
        file: '.env',
        key: 'TOKEN',
        operation: 'set',
        afterPreview: SECRET_PREVIEW,
        at: at(1).toISOString(),
      },
      {
        actor: 'portal',
        file: '.env',
        key: 'TOKEN',
        operation: 'unset',
        beforePreview: SECRET_PREVIEW,
        at: at(2).toISOString(),
      },
      {
        actor: 'cli',
        file: '.env',
        key: 'NAME',
        operation: 'set',
        afterPreview: 'plain',
        at: at(3).toISOString(),
      },
    ]);
    const changes = await readChanges(statePath());
    expect(changes.map(undoBlocker)).toEqual([
      SECRET_UNDO_REASON,
      SECRET_UNDO_REASON,
      LEGACY_UNDO_REASON,
    ]);
    expect(changes.map(isSecretChange)).toEqual([true, true, false]);
  });
});
