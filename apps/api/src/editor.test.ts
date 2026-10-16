import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EditorLauncher, EditorTarget, LaunchResult } from './editor.ts';
import { isLoopbackAddress } from './editor.ts';
import { createServer } from './server.ts';
import {
  type ApiServer,
  TOKEN,
  fixtureEnv,
  fixtureSchema,
  removeProject,
  writeProject,
} from './test-helpers.ts';

const bearer = `Bearer ${TOKEN}`;
let root: string;
let server: ApiServer;
let launched: EditorTarget[];
let result: LaunchResult;

/** A launcher that records what it was asked to open; never an editor. */
const fakeLauncher: EditorLauncher = (target) => {
  launched.push(target);
  return Promise.resolve(result);
};

const open = (body: object) =>
  request(server.url)
    .post('/api/open-in-editor')
    .set('Authorization', bearer)
    .send(body);

const SCHEMA_TEXT = JSON.stringify(fixtureSchema, null, 2);

beforeEach(async () => {
  launched = [];
  result = { opened: true };
  root = await writeProject({
    'env.schema.json': SCHEMA_TEXT,
    '.env': `# local\n${fixtureEnv}`,
    'config/app.env': 'PORT=1\n',
    'notes.txt': 'not a schema file\n',
  });
  server = await createServer({
    root,
    schemaPath: 'env.schema.json',
    port: 0,
    token: TOKEN,
    editor: fakeLauncher,
  });
});

afterEach(async () => {
  await server.close();
  await removeProject(root);
});

describe('POST /api/open-in-editor', () => {
  it('opens a schema file at the line and column it is given', async () => {
    const response = await open({ file: '.env', line: 3, column: 2 });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      opened: true,
      file: '.env',
      line: 3,
      column: 2,
    });
    expect(launched).toEqual([
      { file: join(root, '.env'), line: 3, column: 2 },
    ]);
  });

  it('opens at the top when no position is asked', async () => {
    const response = await open({ file: 'config/app.env' });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ opened: true, line: 1, column: 1 });
    expect(launched).toEqual([
      { file: join(root, 'config/app.env'), line: 1, column: 1 },
    ]);
  });

  describe('resolves the line', () => {
    it("of a variable's entry in an env file, from the dotenv parser", async () => {
      const response = await open({ file: '.env', key: 'DB_PASSWORD' });
      expect(response.status).toBe(200);
      // Line 1 is the comment the fixture is prefixed with.
      expect(response.body).toEqual({
        opened: true,
        file: '.env',
        line: 4,
        column: 1,
      });
      expect(launched).toEqual([
        { file: join(root, '.env'), line: 4, column: 1 },
      ]);
    });

    it('at the top of an env file that does not set the variable', async () => {
      const response = await open({ file: '.env', key: 'API_KEY' });
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ line: 1, column: 1 });
    });

    it('of a JSON path in the schema, from its source map', async () => {
      const response = await open({
        file: 'env.schema.json',
        path: 'files[2].variables[1]',
      });
      expect(response.status).toBe(200);
      const lines = SCHEMA_TEXT.split('\n');
      // The array element, alone on its line: `"LOG_LEVEL"`.
      const line = lines.findIndex((text) => text.trim() === '"LOG_LEVEL"') + 1;
      expect(line).toBeGreaterThan(0);
      expect(response.body).toEqual({
        opened: true,
        file: 'env.schema.json',
        line,
        column: 9,
      });
      expect(launched).toEqual([
        { file: join(root, 'env.schema.json'), line, column: 9 },
      ]);
    });

    it("of a variable's definition in the schema", async () => {
      const response = await open({ file: 'env.schema.json', key: 'PORT' });
      const line =
        SCHEMA_TEXT.split('\n').findIndex((text) =>
          text.includes('"PORT": {'),
        ) + 1;
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ line, column: 5 });
    });

    it('of an invalid schema, so its errors can be opened', async () => {
      await writeFile(
        join(root, 'env.schema.json'),
        '{\n  "version": 2,\n  "variables": {}\n}\n',
      );
      const response = await open({ file: 'env.schema.json', path: 'version' });
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ line: 2, column: 3 });
    });

    it('refuses a JSON path for an env file', async () => {
      const response = await open({ file: '.env', path: 'version' });
      expect(response.status).toBe(422);
      expect(response.body.message).toMatch(/JSON path/);
      expect(launched).toEqual([]);
    });
  });

  describe('path containment', () => {
    it.each([
      ['an absolute path', join(tmpdir(), 'x.env')],
      ['a path that leaves the root', '../outside.env'],
      ['a dot segment', './.env'],
      ['a backslash', 'config\\app.env'],
    ])('refuses %s with 403', async (_label, file) => {
      const response = await open({ file });
      expect(response.status).toBe(403);
      expect(response.body.statusCode).toBe(403);
      expect(launched).toEqual([]);
    });

    it('refuses a file inside the root the project does not know', async () => {
      const response = await open({ file: 'notes.txt' });
      expect(response.status).toBe(404);
      expect(response.body.message).toBe(
        'notes.txt is not the schema file or one of its env files',
      );
      expect(launched).toEqual([]);
    });

    it('refuses an env file that is a symlink leading out of the root', async () => {
      const outside = await writeProject({ 'secret.env': 'A=1\n' });
      try {
        await removeProject(join(root, 'config'));
        await symlink(outside, join(root, 'config'));
        const response = await open({ file: 'config/app.env' });
        expect(response.status).toBe(403);
        expect(response.body.message).toMatch(/outside the root/);
        expect(launched).toEqual([]);
      } finally {
        await removeProject(outside);
      }
    });

    it('refuses an env file that is itself a symlink', async () => {
      await removeProject(join(root, 'config'));
      await mkdir(join(root, 'config'));
      await symlink(join(root, '.env'), join(root, 'config/app.env'));
      const response = await open({ file: 'config/app.env' });
      expect(response.status).toBe(403);
      expect(launched).toEqual([]);
    });

    it('answers 404 for a schema file that does not exist yet', async () => {
      const response = await open({ file: '.env.example' });
      expect(response.status).toBe(404);
      expect(response.body.message).toBe('.env.example: no such file');
      expect(launched).toEqual([]);
    });
  });

  it('answers a typed result when no editor is found', async () => {
    result = {
      opened: false,
      reason: 'no-editor',
      message: 'no editor found',
    };
    const response = await open({ file: '.env', key: 'PORT' });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      opened: false,
      reason: 'no-editor',
      message: 'no editor found',
      file: '.env',
      line: 3,
      column: 1,
    });
  });

  it('refuses a body with a key and a path, or a bad position', async () => {
    for (const body of [
      { file: '.env', key: 'PORT', path: 'version' },
      { file: '.env', line: 0 },
      { file: '.env', extra: true },
      {},
    ]) {
      const response = await open(body);
      expect(response.status).toBe(400);
    }
    expect(launched).toEqual([]);
  });

  it('needs the session token', async () => {
    const response = await request(server.url)
      .post('/api/open-in-editor')
      .send({ file: '.env' });
    expect(response.status).toBe(401);
    expect(launched).toEqual([]);
  });

  it('needs the Origin with the session cookie, like every change', async () => {
    const cookie = `configure_env_token_${server.port}=${TOKEN}`;
    const refused = await request(server.url)
      .post('/api/open-in-editor')
      .set('Cookie', cookie)
      .send({ file: '.env' });
    expect(refused.status).toBe(403);
    const accepted = await request(server.url)
      .post('/api/open-in-editor')
      .set('Cookie', cookie)
      .set('Origin', server.url)
      .send({ file: '.env' });
    expect(accepted.status).toBe(200);
    expect(launched).toHaveLength(1);
  });
});

describe('loopback only', () => {
  it('tells the loopback addresses', () => {
    for (const address of [
      '127.0.0.1',
      '127.8.9.10',
      '::1',
      '::ffff:127.0.0.1',
    ])
      expect(isLoopbackAddress(address)).toBe(true);
    for (const address of ['10.0.0.2', '::ffff:192.168.1.4', 'fe80::1', ''])
      expect(isLoopbackAddress(address)).toBe(false);
    expect(isLoopbackAddress(undefined)).toBe(false);
  });

  const lan = Object.values(networkInterfaces())
    .flat()
    .find((entry) => entry && entry.family === 'IPv4' && !entry.internal);

  it.skipIf(!lan)(
    'refuses a request from another address with 403',
    async () => {
      const exposed = await createServer({
        root,
        schemaPath: 'env.schema.json',
        host: lan!.address,
        port: 0,
        token: TOKEN,
        editor: fakeLauncher,
      });
      try {
        const response = await request(exposed.url)
          .post('/api/open-in-editor')
          .set('Authorization', bearer)
          .send({ file: '.env' });
        expect(response.status).toBe(403);
        expect(response.body.message).toBe(
          'open-in-editor answers only requests from this machine',
        );
        expect(launched).toEqual([]);
        // The other routes still answer there.
        const health = await request(exposed.url)
          .get('/api/health')
          .set('Authorization', bearer);
        expect(health.status).toBe(200);
      } finally {
        await exposed.close();
      }
    },
  );
});
