// createServer's own lifecycle: a taken port rejects with its error code,
// so `configure-env serve` can move on to the next port.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from './server.ts';
import {
  type ApiServer,
  TOKEN,
  fixtureProject,
  removeProject,
  startServer,
} from './test-helpers.ts';

let root: string;
let first: ApiServer;

beforeEach(async () => {
  root = await fixtureProject();
  first = await startServer(root);
});

afterEach(async () => {
  await first.close();
  await removeProject(root);
});

describe('createServer', () => {
  it('rejects a taken port with EADDRINUSE', async () => {
    await expect(
      createServer({
        root,
        schemaPath: 'env.schema.json',
        port: first.port,
        token: TOKEN,
      }),
    ).rejects.toMatchObject({ code: 'EADDRINUSE' });
  });
});
