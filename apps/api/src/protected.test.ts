import { join } from 'node:path';
import { DEFAULT_STATE_PATH, updateState } from '@configure-env/core';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test';
import {
  type ApiServer,
  SESSION_KEY,
  TOKEN,
  protectedProject,
  removeProject,
  startServer,
} from './test-helpers.ts';

let root: string;
let server: ApiServer;
const get = (path: string) =>
  request(server.url).get(path).set('Authorization', `Bearer ${TOKEN}`);

beforeEach(async () => {
  root = await protectedProject();
  // The state recorded another SESSION_KEY: the file's no longer matches.
  await updateState(join(root, DEFAULT_STATE_PATH), [
    {
      action: 'record',
      file: '.env',
      key: 'SESSION_KEY',
      value: 'the-recorded-session-key',
      replace: false,
      at: new Date('2026-03-04T00:00:00Z'),
    },
  ]);
  server = await startServer(root);
});

afterEach(async () => {
  await server.close();
  await removeProject(root);
});

const MISMATCH = {
  kind: 'protected',
  key: 'SESSION_KEY',
  message: 'no longer matches the value recorded on 2026-03-04',
  reason: 'signs every session',
};

describe('protected values that no longer match the state', () => {
  it('are reported by GET /api/check', async () => {
    const response = await get('/api/check');
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(false);
    expect(response.body.files[0].protected).toEqual([MISMATCH]);
    expect(JSON.stringify(response.body)).not.toContain(SESSION_KEY);
  });

  it('are errors of GET /api/validate', async () => {
    const response = await get('/api/validate');
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(false);
    expect(response.body.files[0].errors).toContainEqual(MISMATCH);
    expect(JSON.stringify(response.body)).not.toContain(SESSION_KEY);
  });
});
