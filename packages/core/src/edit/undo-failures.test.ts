// An undo and a state database that fails: before the write, the undo
// refuses with nothing written; after it, the undo stands and the history's
// failure is a warning, as recordHistory's contract says.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { readChanges } from '../engine/history.ts';
import { DEFAULT_STATE_PATH, loadState } from '../engine/state.ts';
import { schemaOf, useTempRoot } from '../engine/test-helpers.ts';
import type { FileSpec } from '../schema/definition.ts';
import { setValues } from './edit.ts';
import { readEnvFile } from './file.ts';
import { recordHistory, setChanges, undoChange } from './history.ts';

const control = vi.hoisted(() => ({
  /** readChange throws from its second call on: after the undo wrote. */
  failReadAfterFirst: false,
  /** loadState fails once readChange has answered: the salt's read. */
  failSaltAfterRead: false,
  reads: 0,
  saltFails: false,
}));

vi.mock('../engine/history.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../engine/history.ts')>();
  return {
    ...actual,
    readChange: async (path: string, id: number) => {
      control.reads += 1;
      if (control.failReadAfterFirst && control.reads > 1)
        throw new Error(`${path}: in use by another run; try again`);
      const change = await actual.readChange(path, id);
      if (control.failSaltAfterRead) control.saltFails = true;
      return change;
    },
  };
});

vi.mock('../engine/state.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../engine/state.ts')>();
  return {
    ...actual,
    loadState: async (path: string) =>
      control.saltFails
        ? { ok: false, message: `${path}: is not a valid state database` }
        : actual.loadState(path),
  };
});

const temp = useTempRoot();
const schema = schemaOf({
  variables: { NAME: { type: 'string' } },
  files: [{ path: 'app.env', policy: 'merge', variables: '*' }],
});
const spec = schema.files[0] as FileSpec;
const statePath = () => join(temp.dirs.root, DEFAULT_STATE_PATH);
const appPath = () => join(temp.dirs.root, 'app.env');

beforeEach(() => {
  Object.assign(control, {
    failReadAfterFirst: false,
    failSaltAfterRead: false,
    reads: 0,
    saltFails: false,
  });
});

async function editContext() {
  const state = await loadState(statePath());
  if (!state.ok) throw new Error(state.message);
  return {
    schema,
    run: { path: statePath(), state: state.state },
    cwd: temp.dirs.root,
  };
}

/** NAME set from `old` to `new`, recorded; the change's id. */
async function setName(): Promise<number> {
  await writeFile(appPath(), 'NAME=old\n');
  const read = await readEnvFile(temp.dirs.root, spec);
  if (!read.ok) throw new Error(read.message);
  const result = await setValues(
    await editContext(),
    read.file,
    new Map([['NAME', 'new']]),
  );
  if (!result.ok) throw new Error(JSON.stringify(result));
  const { ids } = await recordHistory(
    statePath(),
    'cli',
    setChanges(schema, read.file, result),
  );
  return ids[0]!;
}

async function undo(id: number) {
  return undoChange(
    {
      statePath: statePath(),
      actor: 'portal',
      root: temp.dirs.root,
      schemaPath: 'env.schema.json',
      schemaFile: join(temp.dirs.root, 'env.schema.json'),
      edit: await editContext(),
    },
    id,
  );
}

describe('undoChange and a failing state database', () => {
  it('reports the undo it wrote, the history failing after it as a warning', async () => {
    const id = await setName();
    control.failReadAfterFirst = true;
    const result = await undo(id);
    expect(result).toMatchObject({
      ok: true,
      undone: { id },
      warnings: [
        `the undo was written, but its change could not be read back: ${statePath()}: in use by another run; try again`,
      ],
    });
    expect(result.ok && result.change).toBeUndefined();
    expect(await readFile(appPath(), 'utf8')).toBe('NAME=old\n');
    // The undo itself was recorded; only reading it back failed.
    expect(await readChanges(statePath())).toHaveLength(2);
  });

  it('refuses, writing nothing, when the salt cannot be read before the write', async () => {
    const id = await setName();
    const context = await editContext();
    control.failSaltAfterRead = true;
    const result = await undoChange(
      {
        statePath: statePath(),
        actor: 'portal',
        root: temp.dirs.root,
        schemaPath: 'env.schema.json',
        schemaFile: join(temp.dirs.root, 'env.schema.json'),
        edit: context,
      },
      id,
    );
    expect(result).toMatchObject({
      ok: false,
      kind: 'state',
      path: statePath(),
      lines: [`${statePath()}: is not a valid state database`],
      change: { id },
    });
    expect(await readFile(appPath(), 'utf8')).toBe('NAME=new\n');
    control.saltFails = false;
    control.failSaltAfterRead = false;
    expect(await readChanges(statePath())).toHaveLength(1);
  });
});
