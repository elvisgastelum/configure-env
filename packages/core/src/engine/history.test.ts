import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import type { VariableSpec } from '../schema/definition.ts';
import {
  LEGACY_UNDO_REASON,
  SCHEMA_CREATE_UNDO_REASON,
  SECRET_UNDO_REASON,
  UNDECLARED_UNDO_REASON,
  queryChanges,
  readChange,
  readChanges,
  recordChanges,
  undoBlocker,
} from './history.ts';
import { schemaFingerprint } from '../writer/store.ts';
import { DEFAULT_STATE_PATH, fingerprint, loadState } from './state.ts';
import { useTempRoot } from './test-helpers.ts';

const temp = useTempRoot();
const statePath = () => join(temp.dirs.root, DEFAULT_STATE_PATH);
const plain: VariableSpec = { type: 'string', required: false, secret: false };
const secret: VariableSpec = { ...plain, secret: true };
const AT = new Date('2026-01-02T03:04:05.000Z');

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

  it('migrates a database an older version wrote; its changes cannot be undone', async () => {
    await recordChanges(statePath(), 'cli', [set('.env', 'A')], at(1));
    const sqlite = new Database(statePath());
    for (const column of [
      'before_value',
      'after_value',
      'restorable',
      'undo_of',
      'not_kept',
    ])
      sqlite.exec(`alter table changes drop column ${column}`);
    sqlite.exec("update meta set value = '1' where key = 'schema_version'");
    sqlite.close();
    const { changes } = await queryChanges(statePath());
    expect(changes).toMatchObject([
      {
        id: 1,
        key: 'A',
        beforeValue: null,
        afterValue: null,
        restorable: false,
      },
    ]);
    expect(undoBlocker(changes[0]!)).toBe(LEGACY_UNDO_REASON);
  });
});
