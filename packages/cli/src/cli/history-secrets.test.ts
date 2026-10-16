// No value of a secret, nor of a key the schema does not declare, reaches
// the history: not when the file's own variable list leaves the secret out,
// not through set, unset or apply --prune, not in the database's bytes (its
// WAL and shared-memory files included) and not in `history`.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DEFAULT_STATE_PATH,
  SECRET_UNDO_REASON,
  UNDECLARED_UNDO_REASON,
} from '@configure-env/core';
import { describe, expect, it } from 'vitest';
import { run, useProject } from './test-helpers.ts';

const SCHEMA = {
  version: 1,
  variables: {
    HOST: { type: 'string' },
    API_KEY: { type: 'string', secret: true },
  },
  files: [
    { path: '.env', policy: 'merge', variables: '*' },
    { path: '.env.local', policy: 'merge', variables: ['HOST'] },
  ],
};

const dirs = useProject(SCHEMA);
const cli = (argv: string[]) => run(argv, { cwd: dirs.root });
const path = (name: string) => join(dirs.root, name);
// Built at run time: no secret-looking literal in the sources.
const fake = (tag: string) => ['ak', tag, 'q'.repeat(14)].join('-');

/** The database's bytes, with its WAL and shared-memory files when present. */
async function stateBytes(): Promise<string> {
  const base = path(DEFAULT_STATE_PATH);
  const parts = await Promise.all(
    [base, `${base}-wal`, `${base}-shm`].map((file) =>
      readFile(file).catch(() => Buffer.alloc(0)),
    ),
  );
  return Buffer.concat(parts).toString('latin1');
}

/** Everything `history` and `history --json` print. */
async function historyText(): Promise<string> {
  const text = await cli(['history']);
  const json = await cli(['history', '--json']);
  expect(text.code).toBe(0);
  expect(json.code).toBe(0);
  return [...text.out, ...json.out].join('\n');
}

describe('the history keeps no secret value', () => {
  it('when the file does not list the secret the schema declares', async () => {
    const first = fake('one');
    const second = fake('two');
    await writeFile(path('.env.local'), `HOST=a\nAPI_KEY=${first}\n`);

    expect(
      (await cli(['unset', '--ci', '--file', '.env.local', 'API_KEY'])).code,
    ).toBe(0);
    expect(
      (
        await cli([
          'set',
          '--ci',
          '--file',
          '.env.local',
          '--allow-unknown',
          `API_KEY=${second}`,
        ])
      ).code,
    ).toBe(0);

    const printed = await historyText();
    const bytes = await stateBytes();
    for (const value of [first, second]) {
      expect(printed).not.toContain(value);
      expect(bytes).not.toContain(value);
    }
    const { changes } = JSON.parse(
      (await cli(['history', '--json'])).out.join(''),
    );
    expect(changes).toMatchObject([
      { key: 'API_KEY', after: '••••', restorable: false },
      { key: 'API_KEY', before: '••••', restorable: false },
    ]);
    expect(changes[0].undoBlocker).toBe(SECRET_UNDO_REASON);
  });

  it('nor of a key the schema does not declare, set or pruned', async () => {
    const stray = fake('stray');
    const pruned = fake('pruned');
    await writeFile(path('.env'), `HOST=a\nOLD_TOKEN=${pruned}\n`);

    expect(
      (
        await cli([
          'set',
          '--ci',
          '--file',
          '.env',
          '--allow-unknown',
          `STRAY=${stray}`,
        ])
      ).code,
    ).toBe(0);
    expect(
      (await cli(['apply', '--ci', '--prune', '--file', '.env'])).code,
    ).toBe(0);

    const printed = await historyText();
    const bytes = await stateBytes();
    for (const value of [stray, pruned]) {
      expect(printed).not.toContain(value);
      expect(bytes).not.toContain(value);
    }
    const { changes } = JSON.parse(
      (await cli(['history', '--json'])).out.join(''),
    );
    const byKey = Object.fromEntries(
      changes.map((change: { key: string }) => [change.key, change]),
    );
    expect(byKey.STRAY).toMatchObject({
      after: '••••',
      restorable: false,
      undoBlocker: UNDECLARED_UNDO_REASON,
    });
    expect(byKey.OLD_TOKEN).toMatchObject({
      operation: 'unset',
      before: '••••',
      restorable: false,
      undoBlocker: UNDECLARED_UNDO_REASON,
    });
  });

  it('still keeps a declared value that is not secret, in any file', async () => {
    await writeFile(path('.env.local'), 'HOST=a\n');
    await cli(['set', '--ci', '--file', '.env.local', 'HOST=b']);
    const { changes } = JSON.parse(
      (await cli(['history', '--json'])).out.join(''),
    );
    expect(changes).toMatchObject([
      { key: 'HOST', before: 'a', after: 'b', restorable: true },
    ]);
  });
});
