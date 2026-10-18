// The MCP server's tools against another environment: `env` names one
// configure-env env add stored, and the tool reaches its server through the
// configure-env API, which owns that project.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test';
import { readChanges } from '@configure-env/core';
import { cliIn, useRemote } from './env-test-helpers.ts';
import { type McpOptions, createMcpServer } from './mcp-server.ts';
import { STATE, useProject } from './test-helpers.ts';

const SCHEMA = {
  version: 1,
  variables: {
    HOST: { type: 'string', default: 'localhost' },
    API_KEY: { type: 'string', secret: true, required: true },
  },
  files: [{ path: '.env', policy: 'merge', variables: '*' }],
};
const TEXT = `${JSON.stringify(SCHEMA, null, 2)}\n`;

// This project has no schema: every answer below is the remote one's.
const dirs = useProject(null);
const cli = cliIn(() => dirs.root);
const { remote, makeRoot, start, add } = useRemote();

const clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

beforeEach(async () => {
  await makeRoot();
  await writeFile(join(remote.root, 'env.schema.json'), TEXT);
  await writeFile(join(remote.root, '.env'), 'HOST=remote.test\n');
  await start();
  await add(cli);
});

async function connect(options: Partial<McpOptions> = {}): Promise<Client> {
  const server = createMcpServer({
    cwd: dirs.root,
    env: {},
    version: '0.0.0-test',
    ...options,
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  clients.push(client);
  return client;
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ text: string; isError: boolean }> {
  const result = (await client.callTool({ name, arguments: args })) as {
    content: { text: string }[];
    isError?: boolean;
  };
  return {
    text: result.content.map((part) => part.text).join('\n'),
    isError: result.isError ?? false,
  };
}

const remoteSchema = () =>
  readFile(join(remote.root, 'env.schema.json'), 'utf8');

describe('the MCP tools with env', () => {
  it('offers env on every tool', async () => {
    const { tools } = await (await connect()).listTools();
    expect(tools.length).toBeGreaterThan(10);
    for (const tool of tools)
      expect(Object.keys(tool.inputSchema.properties ?? {})).toContain('env');
  });

  it("lists and sets the environment's values on its server", async () => {
    const client = await connect();
    const listed = await call(client, 'list_variables', { env: 'staging' });
    expect(listed.isError).toBe(false);
    expect(listed.text).toContain('remote.test');
    const set = await call(client, 'set_values', {
      env: 'staging',
      values: { HOST: 'set.test' },
    });
    expect(set.isError).toBe(false);
    expect(await readFile(join(remote.root, '.env'), 'utf8')).toBe(
      'HOST=set.test\n',
    );
  });

  it("checks the environment's project on its server", async () => {
    const result = await call(await connect(), 'check', { env: 'staging' });
    expect(result.isError).toBe(true);
    const report = JSON.parse(result.text.split('\n')[0]!) as {
      command: string;
      files: { path: string }[];
    };
    expect(report.command).toBe('check');
    expect(report.files.map((file) => file.path)).toEqual(['.env']);
    expect(result.text).toContain('API_KEY');
  });

  it("applies the environment's project on its server, the secret made there", async () => {
    const client = await connect();
    const missing = await call(client, 'apply', { env: 'staging' });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain('API_KEY');
    expect(await readFile(join(remote.root, '.env'), 'utf8')).toBe(
      'HOST=remote.test\n',
    );
    const result = await call(client, 'apply', {
      env: 'staging',
      generate: ['API_KEY'],
    });
    expect(result.isError).toBe(false);
    const written = await readFile(join(remote.root, '.env'), 'utf8');
    const value = /^API_KEY=(.+)$/m.exec(written)?.[1];
    expect(value).toMatch(/^[A-Za-z0-9_-]{48}$/);
    expect(result.text).not.toContain(value);
    // This project gets nothing: no env file, no state.
    await expect(readFile(join(dirs.root, '.env'), 'utf8')).rejects.toThrow();
    const rows = await readChanges(join(remote.root, STATE));
    expect(rows.map((row) => [row.actor, row.key])).toEqual([
      ['cli', 'API_KEY'],
    ]);
  });

  it('leaves out the --root it was started with, which is this project', async () => {
    const result = await call(await connect({ root: '.' }), 'check', {
      env: 'staging',
    });
    expect(result.text).not.toMatch(/does not apply/);
    expect(result.text).toContain('API_KEY');
  });

  it("reads the environment's schema with its fingerprint", async () => {
    const result = await call(await connect(), 'get_schema', {
      env: 'staging',
    });
    expect(result.isError).toBe(false);
    const schema = JSON.parse(result.text) as {
      path: string;
      fingerprint: string;
      text: string;
    };
    expect(schema).toEqual({
      path: 'staging:env.schema.json',
      fingerprint: expect.stringMatching(/^sha256:/),
      text: TEXT,
    });
  });

  it('updates the schema there, recording the change in its history', async () => {
    const client = await connect();
    const { fingerprint } = JSON.parse(
      (await call(client, 'get_schema', { env: 'staging' })).text,
    ) as { fingerprint: string };
    const document = {
      ...SCHEMA,
      variables: { ...SCHEMA.variables, DEBUG: { type: 'boolean' } },
    };
    const result = await call(client, 'update_schema', {
      env: 'staging',
      document,
      fingerprint,
    });
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.text)).toEqual({
      ok: true,
      written: true,
      fingerprint: expect.stringMatching(/^sha256:/),
    });
    expect(JSON.parse(await remoteSchema()).variables.DEBUG).toEqual({
      type: 'boolean',
    });
    expect(await readChanges(join(remote.root, STATE))).toMatchObject([
      { actor: 'cli', file: 'env.schema.json', operation: 'schema' },
    ]);
  });

  it('refuses there a schema that would unmask a value its files hold', async () => {
    await writeFile(join(remote.root, '.env'), 'HOST=remote.test\nLEGACY=x\n');
    const client = await connect();
    const { fingerprint } = JSON.parse(
      (await call(client, 'get_schema', { env: 'staging' })).text,
    ) as { fingerprint: string };
    const result = await call(client, 'update_schema', {
      env: 'staging',
      document: {
        ...SCHEMA,
        variables: { ...SCHEMA.variables, LEGACY: { type: 'string' } },
      },
      fingerprint,
    });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.text)).toMatchObject({
      ok: false,
      kind: 'secret',
    });
    expect(result.text).toContain('unmask LEGACY');
    expect(await remoteSchema()).toBe(TEXT);
  });

  it('refuses a stale fingerprint there, writing nothing', async () => {
    const result = await call(await connect(), 'update_schema', {
      env: 'staging',
      document: SCHEMA,
      fingerprint: 'sha256:0',
    });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.text)).toMatchObject({
      ok: false,
      kind: 'stale',
    });
    expect(await remoteSchema()).toBe(TEXT);
  });

  it("refuses a secret by the environment's schema", async () => {
    const result = await call(await connect(), 'set_values', {
      env: 'staging',
      values: { API_KEY: 'x' },
    });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/^API_KEY: secret;/);
  });

  it('hands the user the command that names the environment', async () => {
    const result = await call(await connect({ root: '.' }), 'request_secret', {
      env: 'staging',
      key: 'API_KEY',
    });
    expect(result.isError).toBe(false);
    const { command, npx } = JSON.parse(result.text) as {
      command: string;
      npx: string;
    };
    // .env exists there: no --create.
    expect(command).toBe(
      `cd ${dirs.root} && configure-env set --env staging --prompt API_KEY`,
    );
    expect(npx).toBe(
      `cd ${dirs.root} && npx @elvisgastelum/configure-env set --env staging --prompt API_KEY`,
    );
  });

  it('names an environment it does not hold', async () => {
    const result = await call(await connect(), 'get_schema', { env: 'prod' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('no environment named prod');
  });
});
