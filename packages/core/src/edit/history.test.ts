import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { readChanges, SECRET_UNDO_REASON } from '../engine/history.ts';
import { DEFAULT_STATE_PATH, loadState } from '../engine/state.ts';
import { schemaOf, useTempRoot } from '../engine/test-helpers.ts';
import type { FileSpec } from '../schema/definition.ts';
import type { SchemaDocument } from '../writer/document.ts';
import { schemaFingerprint, writeSchemaFile } from '../writer/store.ts';
import { type EditContext, setValues, unsetValues } from './edit.ts';
import { readEnvFile } from './file.ts';
import {
  type UndoContext,
  recordHistory,
  schemaChanges,
  setChanges,
  undoChange,
  unsetChanges,
} from './history.ts';

const temp = useTempRoot();

const schema = schemaOf({
  variables: {
    PORT: { type: 'port', default: 8080 },
    NAME: { type: 'string' },
    TOKEN: { type: 'string', secret: true, minLength: 8 },
  },
  files: [{ path: 'app.env', policy: 'merge', variables: '*' }],
});
const spec = schema.files[0] as FileSpec;
const SCHEMA_PATH = 'env.schema.json';

const statePath = () => join(temp.dirs.root, DEFAULT_STATE_PATH);
const appPath = () => join(temp.dirs.root, 'app.env');
const schemaFile = () => join(temp.dirs.root, SCHEMA_PATH);
const content = () => readFile(appPath(), 'utf8');
// Built at run time: no secret-looking literal in the sources.
const fakeSecret = (tag: string) => ['tok', tag, 'x'.repeat(12)].join('-');

async function editContext(): Promise<EditContext> {
  const state = await loadState(statePath());
  if (!state.ok) throw new Error(state.message);
  return {
    schema,
    run: { path: statePath(), state: state.state },
    cwd: temp.dirs.root,
  };
}

async function undoContext(): Promise<UndoContext> {
  return {
    statePath: statePath(),
    actor: 'portal',
    root: temp.dirs.root,
    schemaPath: SCHEMA_PATH,
    schemaFile: schemaFile(),
    edit: await editContext(),
  };
}

async function fileOf() {
  const result = await readEnvFile(temp.dirs.root, spec);
  if (!result.ok) throw new Error(result.message);
  return result.file;
}

/** Sets `pairs` in app.env as the CLI does, recording the change. */
async function set(pairs: Record<string, string>) {
  const file = await fileOf();
  const result = await setValues(
    await editContext(),
    file,
    new Map(Object.entries(pairs)),
  );
  if (!result.ok) throw new Error(JSON.stringify(result));
  return (await recordHistory(statePath(), 'cli', setChanges(file, result)))
    .ids;
}

async function unset(...keys: string[]) {
  const file = await fileOf();
  const result = await unsetValues(await editContext(), file, keys);
  if (!result.ok) throw new Error(JSON.stringify(result));
  return (
    await recordHistory(statePath(), 'cli', unsetChanges(schema, file, result))
  ).ids;
}

describe('undoChange', () => {
  it('sets the previous value back and records the undo', async () => {
    await writeFile(appPath(), 'NAME=old\n');
    const [id] = await set({ NAME: 'new' });
    const result = await undoChange(await undoContext(), id!);
    expect(result).toMatchObject({
      ok: true,
      undone: { id, key: 'NAME', afterValue: 'new' },
      change: {
        id: 2,
        actor: 'portal',
        operation: 'set',
        beforeValue: 'new',
        afterValue: 'old',
        restorable: true,
        undoOf: id,
      },
      warnings: [],
    });
    expect(await content()).toBe('NAME=old\n');
  });

  it('removes a key the change added, and adds back a key it removed', async () => {
    await writeFile(appPath(), 'PORT=1\n');
    const [added] = await set({ NAME: 'x' });
    expect((await undoChange(await undoContext(), added!)).ok).toBe(true);
    expect(await content()).toBe('PORT=1\n');
    const [removed] = await unset('PORT');
    expect(await content()).toBe('');
    const undone = await undoChange(await undoContext(), removed!);
    expect(undone).toMatchObject({
      ok: true,
      change: { operation: 'set', beforeValue: null, afterValue: '1' },
    });
    expect(await content()).toBe('PORT=1\n');
  });

  it('refuses when the value changed since, writing nothing', async () => {
    await writeFile(appPath(), 'NAME=old\n');
    const [id] = await set({ NAME: 'new' });
    await writeFile(appPath(), 'NAME=edited\n');
    expect(await undoChange(await undoContext(), id!)).toMatchObject({
      ok: false,
      kind: 'mismatch',
      message:
        'NAME in app.env no longer holds the value this change wrote, so it was not undone; it changed after this change was made',
      change: { id },
    });
    expect(await content()).toBe('NAME=edited\n');
    await writeFile(appPath(), '');
    expect(await undoChange(await undoContext(), id!)).toMatchObject({
      kind: 'mismatch',
      message:
        'NAME is no longer set in app.env, so this change was not undone; it changed after this change was made',
    });
    expect(await readChanges(statePath())).toHaveLength(1);
  });

  it('refuses a change already undone', async () => {
    await writeFile(appPath(), 'NAME=old\n');
    const [id] = await set({ NAME: 'new' });
    expect((await undoChange(await undoContext(), id!)).ok).toBe(true);
    expect(await undoChange(await undoContext(), id!)).toMatchObject({
      kind: 'mismatch',
    });
    expect(await content()).toBe('NAME=old\n');
  });

  it("never undoes a secret's change: its value is not kept", async () => {
    const before = fakeSecret('before');
    const after = fakeSecret('after');
    await writeFile(appPath(), `TOKEN=${before}\n`);
    const [id] = await set({ TOKEN: after });
    expect(await undoChange(await undoContext(), id!)).toEqual({
      ok: false,
      kind: 'not-restorable',
      message: SECRET_UNDO_REASON,
      change: expect.objectContaining({
        id,
        beforeValue: null,
        afterValue: null,
        restorable: false,
      }),
    });
    expect(await content()).toBe(`TOKEN=${after}\n`);
    const sqlite = new Database(statePath(), { readonly: true });
    const dump = JSON.stringify(sqlite.prepare('select * from changes').all());
    sqlite.close();
    expect(dump).not.toContain(before);
    expect(dump).not.toContain(after);
  });

  it('answers not-found for an unknown id', async () => {
    expect(await undoChange(await undoContext(), 42)).toEqual({
      ok: false,
      kind: 'not-found',
      message: 'no change 42 in the history',
    });
  });

  it('refuses a value change while the schema is invalid', async () => {
    await writeFile(appPath(), 'NAME=old\n');
    const [id] = await set({ NAME: 'new' });
    const context = { ...(await undoContext()), edit: undefined };
    expect(await undoChange(context, id!)).toMatchObject({
      ok: false,
      kind: 'invalid',
      messages: [
        'the schema is not valid; fix it before undoing a change to a value',
      ],
    });
  });
});

describe('undoChange of a schema write', () => {
  const documentOf = (keys: string[]): SchemaDocument => ({
    version: 1,
    variables: Object.fromEntries(keys.map((key) => [key, { type: 'string' }])),
    files: [],
  });

  /** Writes the schema with `keys` over the current one, recording it. */
  async function writeSchema(keys: string[]) {
    const before = await readFile(schemaFile(), 'utf8');
    const written = await writeSchemaFile(schemaFile(), documentOf(keys), {
      fingerprint: schemaFingerprint(before),
    });
    if (!written.ok) throw new Error(JSON.stringify(written));
    return (
      await recordHistory(
        statePath(),
        'portal',
        schemaChanges(SCHEMA_PATH, written.previous, written.file.text),
      )
    ).ids;
  }

  it('writes the previous schema back, then refuses once it changed', async () => {
    await writeFile(
      schemaFile(),
      `${JSON.stringify(documentOf(['A']), null, 2)}\n`,
    );
    const original = await readFile(schemaFile(), 'utf8');
    const [id] = await writeSchema(['A', 'B']);
    expect(await undoChange(await undoContext(), id!)).toMatchObject({
      ok: true,
      undone: { id, operation: 'schema' },
      change: {
        operation: 'schema',
        key: '',
        afterPreview: '1 variable, 0 files',
        undoOf: id,
      },
    });
    expect(await readFile(schemaFile(), 'utf8')).toBe(original);

    const [next] = await writeSchema(['C']);
    await writeFile(schemaFile(), `${JSON.stringify(documentOf(['D']))}\n`);
    expect(await undoChange(await undoContext(), next!)).toMatchObject({
      ok: false,
      kind: 'mismatch',
      message:
        'env.schema.json changed after this change was made, so it was not undone',
    });
    await rm(schemaFile());
    expect(await undoChange(await undoContext(), next!)).toMatchObject({
      kind: 'mismatch',
      message:
        'env.schema.json no longer exists, so this change was not undone',
    });
  });

  it('records nothing for a write that changed no text', () => {
    expect(schemaChanges(SCHEMA_PATH, 'same', 'same')).toEqual([]);
  });
});
