import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SchemaDocument } from './document.ts';
import { renameVariable } from './rename.ts';
import { updateVariable } from './variables.ts';
import {
  editSchemaFile,
  readSchemaFile,
  schemaFingerprint,
  writeSchemaFile,
} from './store.ts';

const TEXT = [
  '{',
  '  "$schema": "https://example.com/env.schema.v1.json",',
  '  "version": 1,',
  '  "variables": {',
  '    "PORT": { "type": "port", "default": 8080 },',
  '    "HOST": {',
  '      "type": "host"',
  '    }',
  '  },',
  '  "files": [{ "path": ".env", "policy": "generate", "variables": "*" }]',
  '}',
  '',
].join('\n');

let dir: string;
let path: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'configure-env-writer-'));
  path = join(dir, 'env.schema.json');
  await writeFile(path, TEXT);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Reads the file, failing the test when it is not a valid schema. */
async function read() {
  const result = await readSchemaFile(path);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.file;
}

const withPortDefault = (document: SchemaDocument, value: number) => ({
  ...document,
  variables: {
    ...document.variables,
    PORT: { type: 'port' as const, default: value },
  },
});

describe('schemaFingerprint', () => {
  it('is the sha256 of the text', () => {
    expect(schemaFingerprint('')).toBe(
      'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});

describe('readSchemaFile', () => {
  it('returns the text, its fingerprint, the document as written and the parsed schema', async () => {
    const file = await read();
    expect(file.text).toBe(TEXT);
    expect(file.fingerprint).toBe(schemaFingerprint(TEXT));
    expect(file.document.variables.HOST).toEqual({ type: 'host' });
    expect(file.schema.variables.HOST).toMatchObject({ required: false });
  });

  it('reports a schema that is not valid, with the fingerprint', async () => {
    await writeFile(path, '{ "version": 2 }');
    const result = await readSchemaFile(path);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fingerprint).toBe(schemaFingerprint('{ "version": 2 }'));
    expect(result.errors.map((e) => e.path)).toContain('version');
  });

  it('reports a file it cannot read', async () => {
    const result = await readSchemaFile(join(dir, 'missing.json'));
    expect(result).toEqual({
      ok: false,
      errors: [
        {
          path: '(root)',
          message: expect.stringContaining('ENOENT') as string,
        },
      ],
    });
  });
});

describe('writeSchemaFile', () => {
  it('writes only the change, keeping $schema, key order and formatting', async () => {
    const file = await read();
    const result = await writeSchemaFile(
      path,
      withPortDefault(file.document, 3000),
      { fingerprint: file.fingerprint },
    );
    expect(result).toMatchObject({ ok: true, written: true });
    const text = await readFile(path, 'utf8');
    expect(text).toBe(TEXT.replace('8080', '3000'));
    if (result.ok) {
      expect(result.file.fingerprint).toBe(schemaFingerprint(text));
      expect(result.file.text).toBe(text);
    }
  });

  it('leaves a no-op edit byte for byte as it was, without writing', async () => {
    const before = await stat(path);
    const file = await read();
    const result = await writeSchemaFile(path, structuredClone(file.document), {
      fingerprint: file.fingerprint,
    });
    expect(result).toMatchObject({ ok: true, written: false });
    expect(await readFile(path, 'utf8')).toBe(TEXT);
    expect((await stat(path)).mtimeMs).toBe(before.mtimeMs);
  });

  it('rejects a stale edit when the file changed on disk', async () => {
    const file = await read();
    const changed = TEXT.replace('8080', '9090');
    await writeFile(path, changed);
    const result = await writeSchemaFile(
      path,
      withPortDefault(file.document, 3000),
      { fingerprint: file.fingerprint },
    );
    expect(result).toMatchObject({ ok: false, kind: 'stale' });
    expect(await readFile(path, 'utf8')).toBe(changed);
  });

  it('refuses a document that is not a valid schema and writes nothing', async () => {
    const file = await read();
    const result = await writeSchemaFile(
      path,
      { ...file.document, version: 2 as 1 },
      { fingerprint: file.fingerprint },
    );
    expect(result).toMatchObject({ ok: false, kind: 'invalid' });
    if (!result.ok) expect(result.errors[0]?.path).toBe('version');
    expect(await readFile(path, 'utf8')).toBe(TEXT);
  });

  it('reports a file that is gone', async () => {
    const file = await read();
    await rm(path);
    const result = await writeSchemaFile(path, file.document, {
      fingerprint: file.fingerprint,
    });
    expect(result).toMatchObject({ ok: false, kind: 'io' });
  });

  it.skipIf(process.platform === 'win32')(
    'keeps the mode and leaves no temporary file behind',
    async () => {
      await chmod(path, 0o640);
      const file = await read();
      await writeSchemaFile(path, withPortDefault(file.document, 1), {
        fingerprint: file.fingerprint,
      });
      expect((await stat(path)).mode & 0o777).toBe(0o640);
      expect(await readdir(dir)).toEqual(['env.schema.json']);
    },
  );

  it.skipIf(process.platform === 'win32')(
    'writes through a symlink to its target',
    async () => {
      const link = join(dir, 'link.json');
      await symlink(path, link);
      const result = await readSchemaFile(link);
      if (!result.ok) throw new Error('unreadable');
      await writeSchemaFile(link, withPortDefault(result.file.document, 1), {
        fingerprint: result.file.fingerprint,
      });
      expect((await readFile(path, 'utf8')).includes('"default": 1')).toBe(
        true,
      );
      expect((await lstat(link)).isSymbolicLink()).toBe(true);
    },
  );
});

describe('editSchemaFile', () => {
  it('reads, edits and writes against the expected fingerprint', async () => {
    const { fingerprint } = await read();
    const result = await editSchemaFile(path, fingerprint, (document) => ({
      ok: true,
      document: withPortDefault(document, 1),
      schema: undefined as never,
    }));
    expect(result).toMatchObject({ ok: true, written: true });
    expect(await readFile(path, 'utf8')).toBe(TEXT.replace('8080', '1'));
  });

  it('rejects a stale fingerprint before editing', async () => {
    let called = false;
    const result = await editSchemaFile(path, 'sha256:old', (document) => {
      called = true;
      return { ok: true, document, schema: undefined as never };
    });
    expect(result).toMatchObject({ ok: false, kind: 'stale' });
    expect(called).toBe(false);
  });

  it('passes the errors of a refused edit through', async () => {
    const { fingerprint } = await read();
    const errors = [{ path: 'variables.X', message: 'X is not declared' }];
    const result = await editSchemaFile(path, fingerprint, () => ({
      ok: false,
      errors,
    }));
    expect(result).toEqual({ ok: false, kind: 'invalid', errors });
    expect(await readFile(path, 'utf8')).toBe(TEXT);
  });

  it('writes an operation that changes nothing as no change at all', async () => {
    const { fingerprint } = await read();
    const result = await editSchemaFile(path, fingerprint, (document) =>
      updateVariable(document, 'PORT', { default: 8080 }),
    );
    expect(result).toMatchObject({ ok: true, written: false });
    expect(await readFile(path, 'utf8')).toBe(TEXT);
  });

  it('changes only the lines an operation touches', async () => {
    const { fingerprint } = await read();
    await editSchemaFile(path, fingerprint, (document) =>
      renameVariable(document, 'HOST', 'BIND_HOST'),
    );
    expect(await readFile(path, 'utf8')).toBe(
      TEXT.replace('"HOST"', '"BIND_HOST"'),
    );
  });
});
