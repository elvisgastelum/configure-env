import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import type { VariableSpec } from '../schema/definition.ts';
import { readChanges, recordChanges } from './history.ts';
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

  it('writes nothing for no change', async () => {
    await recordChanges(statePath(), 'portal', []);
    expect(await readChanges(statePath())).toEqual([]);
  });
});
