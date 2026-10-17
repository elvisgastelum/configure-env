import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_STATE_PATH,
  readChanges,
  schemaFingerprint,
} from '@configure-env/core';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type ApiServer,
  TOKEN,
  removeProject,
  startServer,
  writeProject,
} from './test-helpers.ts';

const bearer = `Bearer ${TOKEN}`;
const SCHEMA = {
  version: 1,
  variables: {
    PORT: { type: 'port', default: 3000 },
    HOST: { type: 'host' },
    TOKEN: { type: 'string', secret: true, conflictsWith: ['HOST'] },
  },
  files: [
    { path: '.env', policy: 'merge', variables: '*' },
    { path: 'app.env', policy: 'generate', variables: ['PORT', 'HOST'] },
  ],
};
const TEXT = `${JSON.stringify(SCHEMA, null, 2)}\n`;
const BASE = schemaFingerprint(TEXT);

let root: string;
let server: ApiServer;

async function start(files: Record<string, string>) {
  root = await writeProject(files);
  server = await startServer(root);
}

afterEach(async () => {
  await server.close();
  await removeProject(root);
});

const send = (method: 'post' | 'put' | 'delete', path: string, body: object) =>
  request(server.url)[method](path).set('Authorization', bearer).send(body);
const onDisk = async () =>
  JSON.parse(await readFile(join(root, 'env.schema.json'), 'utf8'));
const diskText = () => readFile(join(root, 'env.schema.json'), 'utf8');

const history = () => readChanges(join(root, DEFAULT_STATE_PATH));

/**
 * The response is the schema now on disk, and names the change it recorded
 * in the history, with the text written.
 */
async function expectWritten(response: request.Response) {
  expect(response.status).toBe(200);
  const text = await diskText();
  const last = (await history()).at(-1);
  expect(response.body).toEqual({
    path: 'env.schema.json',
    valid: true,
    document: JSON.parse(text),
    errors: [],
    fingerprint: schemaFingerprint(text),
    change: last?.id,
  });
  expect(last).toMatchObject({
    actor: 'portal',
    file: 'env.schema.json',
    key: '',
    operation: 'schema',
    afterValue: text,
    afterFingerprint: schemaFingerprint(text),
  });
}

describe('history', () => {
  it('records the text before an edit, so it can be undone', async () => {
    await start({ 'env.schema.json': TEXT });
    const response = await send('post', '/api/schema/variables', {
      fingerprint: BASE,
      name: 'DEBUG',
      spec: { type: 'boolean' },
    });
    await expectWritten(response);
    expect(await history()).toMatchObject([
      {
        beforeValue: TEXT,
        beforeFingerprint: BASE,
        beforePreview: '3 variables, 2 files',
        afterPreview: '4 variables, 2 files',
        restorable: true,
      },
    ]);
  });

  it('records a new schema as a change that cannot be undone', async () => {
    await start({});
    await expectWritten(await send('post', '/api/schema/init', {}));
    expect(await history()).toMatchObject([
      { beforeValue: null, beforeFingerprint: null, restorable: false },
    ]);
  });

  it('records nothing for an edit that leaves the text as it is', async () => {
    await start({ 'env.schema.json': TEXT });
    const same = await send('put', '/api/schema/variables/PORT', {
      fingerprint: BASE,
      changes: { default: 3000 },
    });
    expect(same.status).toBe(200);
    expect(same.body.change).toBeUndefined();
    expect(await history()).toEqual([]);
  });
});

describe('variables', () => {
  it('adds one, joining the files named', async () => {
    await start({ 'env.schema.json': TEXT });
    const response = await send('post', '/api/schema/variables', {
      fingerprint: BASE,
      name: 'DEBUG',
      spec: { type: 'boolean', default: false },
      files: ['app.env'],
    });
    await expectWritten(response);
    const document = await onDisk();
    expect(document.variables.DEBUG).toEqual({
      type: 'boolean',
      default: false,
    });
    expect(document.files[1].variables).toEqual(['PORT', 'HOST', 'DEBUG']);
  });

  it('refuses an invalid spec with JSON paths, writing nothing', async () => {
    await start({ 'env.schema.json': TEXT });
    const response = await send('post', '/api/schema/variables', {
      fingerprint: BASE,
      name: 'DEBUG',
      spec: { type: 'port', default: 'x' },
    });
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      statusCode: 422,
      errors: [{ path: expect.stringMatching(/^variables\.DEBUG/) }],
      schema: { fingerprint: BASE, valid: true },
    });
    expect(await diskText()).toBe(TEXT);
  });

  it('refuses a name already declared', async () => {
    await start({ 'env.schema.json': TEXT });
    const response = await send('post', '/api/schema/variables', {
      fingerprint: BASE,
      name: 'PORT',
      spec: { type: 'port' },
    });
    expect(response.status).toBe(422);
    expect(response.body.errors).toEqual([
      { path: 'variables.PORT', message: 'PORT is already declared' },
    ]);
  });

  it('answers 409 with the current schema when it changed on disk', async () => {
    await start({ 'env.schema.json': TEXT });
    const edited = TEXT.replace('3000', '4000');
    await writeFile(join(root, 'env.schema.json'), edited);
    const response = await send('put', '/api/schema/variables/PORT', {
      fingerprint: BASE,
      changes: { default: 5000 },
    });
    expect(response.status).toBe(409);
    expect(response.body.schema).toMatchObject({
      fingerprint: schemaFingerprint(edited),
      document: { variables: { PORT: { default: 4000 } } },
    });
    expect(await diskText()).toBe(edited);
  });

  it('updates fields in place, removing those set to null', async () => {
    await start({ 'env.schema.json': TEXT });
    const response = await send('put', '/api/schema/variables/PORT', {
      fingerprint: BASE,
      changes: { default: 8080, required: true },
    });
    await expectWritten(response);
    expect((await onDisk()).variables.PORT).toEqual({
      type: 'port',
      default: 8080,
      required: true,
    });
    const removed = await send('put', '/api/schema/variables/PORT', {
      fingerprint: response.body.fingerprint,
      changes: { required: null },
    });
    await expectWritten(removed);
    expect((await onDisk()).variables.PORT).toEqual({
      type: 'port',
      default: 8080,
    });
  });

  it('renames one and every reference to it', async () => {
    await start({ 'env.schema.json': TEXT });
    const response = await send('post', '/api/schema/variables/HOST/rename', {
      fingerprint: BASE,
      to: 'BIND_HOST',
    });
    await expectWritten(response);
    const document = await onDisk();
    expect(Object.keys(document.variables)).toEqual([
      'PORT',
      'BIND_HOST',
      'TOKEN',
    ]);
    expect(document.variables.TOKEN.conflictsWith).toEqual(['BIND_HOST']);
    expect(document.files[1].variables).toEqual(['PORT', 'BIND_HOST']);
  });

  it('reorders them', async () => {
    await start({ 'env.schema.json': TEXT });
    const response = await send('put', '/api/schema/variable-order', {
      fingerprint: BASE,
      order: ['TOKEN', 'PORT', 'HOST'],
    });
    await expectWritten(response);
    expect(Object.keys((await onDisk()).variables)).toEqual([
      'TOKEN',
      'PORT',
      'HOST',
    ]);
  });

  it('refuses an order that misses one', async () => {
    await start({ 'env.schema.json': TEXT });
    const response = await send('put', '/api/schema/variable-order', {
      fingerprint: BASE,
      order: ['TOKEN', 'PORT'],
    });
    expect(response.status).toBe(422);
    expect(response.body.errors).toEqual([
      { path: 'variables', message: 'HOST is missing from the order' },
    ]);
  });

  it('removes one only once its references go, or with cleanup', async () => {
    await start({ 'env.schema.json': TEXT });
    const refused = await send('delete', '/api/schema/variables/HOST', {
      fingerprint: BASE,
    });
    expect(refused.status).toBe(422);
    expect(refused.body.errors.map((e: { path: string }) => e.path)).toEqual([
      'variables.TOKEN.conflictsWith[0]',
      'files[1].variables[1]',
    ]);
    const response = await send('delete', '/api/schema/variables/HOST', {
      fingerprint: BASE,
      cleanup: true,
    });
    await expectWritten(response);
    const document = await onDisk();
    expect(document.variables.HOST).toBeUndefined();
    expect(document.variables.TOKEN.conflictsWith).toBeUndefined();
  });

  it('rejects a name that is not a variable name', async () => {
    await start({ 'env.schema.json': TEXT });
    const response = await send('put', '/api/schema/variables/not-a-name', {
      fingerprint: BASE,
      changes: {},
    });
    expect(response.status).toBe(400);
  });

  it('rejects a body without a fingerprint', async () => {
    await start({ 'env.schema.json': TEXT });
    const response = await send('post', '/api/schema/variables', {
      name: 'DEBUG',
      spec: { type: 'boolean' },
    });
    expect(response.status).toBe(400);
  });
});

describe('files', () => {
  it('adds, updates and removes one', async () => {
    await start({ 'env.schema.json': TEXT });
    const added = await send('post', '/api/schema/files', {
      fingerprint: BASE,
      spec: { path: '.env.example', policy: 'generate', variables: '*' },
      index: 0,
    });
    await expectWritten(added);
    expect((await onDisk()).files[0].path).toBe('.env.example');

    const updated = await send('put', '/api/schema/files', {
      fingerprint: added.body.fingerprint,
      path: '.env',
      changes: { mode: '600' },
    });
    await expectWritten(updated);
    expect((await onDisk()).files[1]).toMatchObject({
      path: '.env',
      mode: '600',
    });

    const removed = await send('delete', '/api/schema/files', {
      fingerprint: updated.body.fingerprint,
      path: 'app.env',
    });
    await expectWritten(removed);
    expect(
      (await onDisk()).files.map((file: { path: string }) => file.path),
    ).toEqual(['.env.example', '.env']);
  });

  it('refuses a path that leaves the root', async () => {
    await start({ 'env.schema.json': TEXT });
    const response = await send('post', '/api/schema/files', {
      fingerprint: BASE,
      spec: { path: '../outside.env', policy: 'merge' },
    });
    expect(response.status).toBe(422);
    expect(response.body.errors[0].path).toMatch(/^files\[2\]/);
    expect(await diskText()).toBe(TEXT);
  });

  it('refuses a file the schema does not have', async () => {
    await start({ 'env.schema.json': TEXT });
    const response = await send('delete', '/api/schema/files', {
      fingerprint: BASE,
      path: 'nope.env',
    });
    expect(response.status).toBe(422);
    expect(response.body.errors).toEqual([
      { path: 'files', message: 'nope.env is not a file of the schema' },
    ]);
  });
});

describe('POST /api/schema/init', () => {
  const EXAMPLE = '# Where to listen.\nPORT=8080\nDEBUG=true\n';
  const getSchema = () =>
    request(server.url).get('/api/schema').set('Authorization', bearer);

  it('names the example init reads while the schema is missing', async () => {
    await start({ '.env.example': EXAMPLE });
    const missing = await getSchema();
    expect(missing.body.valid).toBe(false);
    expect(missing.body.initFrom).toBe('.env.example');
    await expectWritten(await send('post', '/api/schema/init', {}));
    expect((await getSchema()).body).not.toHaveProperty('initFrom');
  });

  it('names none without an example, or with one init would refuse', async () => {
    await start({});
    expect((await getSchema()).body).not.toHaveProperty('initFrom');
    const outside = await mkdtemp(join(tmpdir(), 'configure-env-outside-'));
    try {
      await writeFile(join(outside, 'example'), EXAMPLE);
      await symlink(join(outside, 'example'), join(root, '.env.example'));
      expect((await getSchema()).body).not.toHaveProperty('initFrom');
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('infers a schema from .env.example when there is none', async () => {
    await start({ '.env.example': EXAMPLE });
    const response = await send('post', '/api/schema/init', {});
    await expectWritten(response);
    expect(await onDisk()).toMatchObject({
      version: 1,
      variables: {
        PORT: { type: 'integer', comment: 'Where to listen.', default: 8080 },
        DEBUG: { type: 'boolean', default: true },
      },
      files: [{ path: '.env.example', policy: 'merge', variables: '*' }],
    });
  });

  it('starts an empty schema without an example', async () => {
    await start({});
    const response = await send('post', '/api/schema/init', {});
    await expectWritten(response);
    expect(await onDisk()).toMatchObject({ variables: {}, files: [] });
  });

  it('answers 409 when a schema exists, unless it names its fingerprint', async () => {
    await start({ 'env.schema.json': TEXT, '.env.example': EXAMPLE });
    const refused = await send('post', '/api/schema/init', {});
    expect(refused.status).toBe(409);
    expect(refused.body.schema.fingerprint).toBe(BASE);
    expect(await diskText()).toBe(TEXT);

    const response = await send('post', '/api/schema/init', {
      fingerprint: BASE,
    });
    await expectWritten(response);
    expect(Object.keys((await onDisk()).variables)).toEqual(['PORT', 'DEBUG']);
  });

  it('adds the state directory to .gitignore, as configure-env init does', async () => {
    await start({ '.env.example': EXAMPLE, '.gitignore': 'node_modules' });
    await expectWritten(await send('post', '/api/schema/init', {}));
    expect(await readFile(join(root, '.gitignore'), 'utf8')).toBe(
      'node_modules\n.configure-env/\n',
    );
  });

  it('creates .gitignore when there is none', async () => {
    await start({});
    await expectWritten(await send('post', '/api/schema/init', {}));
    expect(await readFile(join(root, '.gitignore'), 'utf8')).toBe(
      '.configure-env/\n',
    );
  });

  it('never writes through a symlinked .gitignore', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'configure-env-outside-'));
    try {
      await writeFile(join(outside, 'ignore'), 'node_modules\n');
      await start({ '.env.example': EXAMPLE });
      await symlink(join(outside, 'ignore'), join(root, '.gitignore'));
      const response = await send('post', '/api/schema/init', {});
      expect(response.status).toBe(200);
      expect(response.body.valid).toBe(true);
      expect(response.body.warnings).toEqual([
        'cannot update .gitignore: it is a symlink; add .configure-env/ to it yourself',
      ]);
      expect(await readFile(join(outside, 'ignore'), 'utf8')).toBe(
        'node_modules\n',
      );
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('touches nothing when it refuses', async () => {
    await start({ 'env.schema.json': TEXT, '.env.example': EXAMPLE });
    expect((await send('post', '/api/schema/init', {})).status).toBe(409);
    await expect(readFile(join(root, '.gitignore'), 'utf8')).rejects.toThrow(
      /ENOENT/,
    );
  });

  it('needs the token and this server as the origin', async () => {
    await start({ '.env.example': EXAMPLE });
    const anonymous = await request(server.url)
      .post('/api/schema/init')
      .send({});
    expect(anonymous.status).toBe(401);
    const foreign = await send('post', '/api/schema/init', {}).set(
      'Origin',
      'https://evil.example',
    );
    expect(foreign.status).toBe(403);
    await expect(diskText()).rejects.toThrow(/ENOENT/);
  });

  it('reads another example inside the root', async () => {
    await start({ 'config/sample.env': 'NAME=app\n' });
    const response = await send('post', '/api/schema/init', {
      from: 'config/sample.env',
    });
    await expectWritten(response);
    expect((await onDisk()).files).toEqual([
      { path: 'config/sample.env', policy: 'merge', variables: '*' },
    ]);
  });

  it('refuses a source outside the root or missing', async () => {
    await start({});
    const outside = await send('post', '/api/schema/init', {
      from: '../etc/passwd',
    });
    expect(outside.status).toBe(403);
    const missing = await send('post', '/api/schema/init', {
      from: 'missing.env',
    });
    expect(missing.status).toBe(404);
  });
});
