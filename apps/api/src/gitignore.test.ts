import { spawnSync } from 'node:child_process';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import {
  type ApiServer,
  TOKEN,
  fixtureProject,
  removeProject,
  startServer,
} from './test-helpers.ts';

const bearer = `Bearer ${TOKEN}`;
let root: string;
let server: ApiServer | undefined;

/** The fixture project as a git work tree ignoring only config/app.env. */
async function start() {
  root = await fixtureProject();
  const result = spawnSync('git', ['init', '-q'], { cwd: root });
  if (result.status !== 0) throw new Error(String(result.stderr));
  await writeFile(join(root, '.gitignore'), '/config/app.env\n');
  await mkdir(join(root, '.configure-env'));
  server = await startServer(root);
}

afterEach(async () => {
  await server?.close();
  server = undefined;
  await removeProject(root);
});

const getCheck = () =>
  request(server!.url).get('/api/check').set('Authorization', bearer);
const fix = (body: object) =>
  request(server!.url)
    .post('/api/check/gitignore')
    .set('Authorization', bearer)
    .send(body);
const read = (path: string) => readFile(join(root, path), 'utf8');

const STATE_ENTRIES = [
  'state.db',
  'state.db-journal',
  'state.db-wal',
  'state.db-shm',
  'state.json',
];

describe('GET /api/check, git-ignore problems', () => {
  it('lists what git could commit after the files, each an error', async () => {
    await start();
    const response = await getCheck();
    expect(response.status).toBe(200);
    expect(response.body.gitignore).toEqual([
      {
        severity: 'error',
        code: 'state-not-ignored',
        path: '.configure-env',
        gitignore: '.configure-env/.gitignore',
        entries: STATE_ENTRIES,
        message: 'no .gitignore keeps the state out of git',
      },
      {
        severity: 'error',
        code: 'file-not-ignored',
        path: '.env',
        gitignore: '.gitignore',
        entries: ['/.env'],
        message: 'not git-ignored; its values could be committed',
      },
    ]);
  });
});

describe('POST /api/check/gitignore', () => {
  it('fixes every problem without paths, and answers the check after', async () => {
    await start();
    const before = (await getCheck()).body.summary.errors;
    const response = await fix({});
    expect(response.status).toBe(200);
    expect(response.body.fixed).toEqual([
      {
        gitignore: '.configure-env/.gitignore',
        created: true,
        added: STATE_ENTRIES,
      },
      { gitignore: '.gitignore', created: false, added: ['/.env'] },
    ]);
    expect(response.body.check).toMatchObject({
      command: 'check',
      gitignore: [],
      summary: { errors: before - 2 },
    });
    expect(await read('.gitignore')).toBe('/config/app.env\n/.env\n');
  });

  it('fixes only the problems it names by path', async () => {
    await start();
    const response = await fix({ paths: ['.env'] });
    expect(response.status).toBe(200);
    expect(response.body.fixed).toEqual([
      { gitignore: '.gitignore', created: false, added: ['/.env'] },
    ]);
    expect(
      response.body.check.gitignore.map((p: { path: string }) => p.path),
    ).toEqual(['.configure-env']);
  });

  it('writes nothing for a path with no problem, nor through a symlink', async () => {
    await start();
    await writeFile(join(root, 'elsewhere'), '');
    await symlink(
      join(root, 'elsewhere'),
      join(root, '.configure-env', '.gitignore'),
    );
    const response = await fix({ paths: ['.configure-env', 'nope.env'] });
    expect(response.status).toBe(200);
    expect(response.body.fixed).toEqual([]);
    expect(response.body.check.gitignore[0]).toMatchObject({
      path: '.configure-env',
      blocked: 'symlink',
    });
    expect(await read('elsewhere')).toBe('');
  });

  it('refuses a body with an unknown field', async () => {
    await start();
    const response = await fix({ entries: ['/etc/passwd'] });
    expect(response.status).toBe(400);
    expect(await read('.gitignore')).toBe('/config/app.env\n');
  });
});
