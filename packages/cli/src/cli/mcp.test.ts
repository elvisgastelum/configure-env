// `configure-env mcp`: the tools an agent calls, through a real MCP client.
// No tool output ever holds a secret's value.

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { MCP_HELP } from './help.ts';
import { MCP_INSTRUCTIONS, createMcpServer } from './mcp-server.ts';
import { run, useProject } from './test-helpers.ts';

const SCHEMA = {
  version: 1,
  variables: {
    HOST: { type: 'string', default: 'localhost' },
    PORT: { type: 'port', default: 8080 },
    API_KEY: { type: 'string', secret: true },
  },
  files: [{ path: '.env', policy: 'merge', variables: '*' }],
};

const dirs = useProject(SCHEMA);
// Built at run time: no secret-looking literal in the sources.
const SECRET = ['sk', 'live', 'z'.repeat(24)].join('-');

const clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

/** A client connected to a server for the test project. */
async function connect(): Promise<Client> {
  const server = createMcpServer({
    cwd: dirs.root,
    env: {},
    version: '0.0.0-test',
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  clients.push(client);
  return client;
}

interface ToolResult {
  text: string;
  isError: boolean;
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<ToolResult> {
  const result = (await client.callTool({ name, arguments: args })) as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
  return {
    text: result.content.map((part) => part.text).join('\n'),
    isError: result.isError ?? false,
  };
}

const writeEnv = (text: string) => writeFile(join(dirs.root, '.env'), text);

describe('configure-env mcp', () => {
  it('prints its help', async () => {
    const result = await run(['mcp', '--help'], { cwd: dirs.root });
    expect(result).toMatchObject({ code: 0, out: [MCP_HELP] });
  });

  it('refuses an unknown option before serving', async () => {
    const result = await run(['mcp', '--nope'], { cwd: dirs.root });
    expect(result.code).toBe(2);
    expect(result.err.join('\n')).toMatch(/--nope/);
  });

  it('refuses a root that does not exist before serving', async () => {
    const result = await run(['mcp', '--root', 'missing'], { cwd: dirs.root });
    expect(result.code).toBe(2);
    expect(result.err.join('\n')).toMatch(/no such directory/);
  });
});

describe('the MCP server', () => {
  it('tells the agent how secrets go in', async () => {
    const client = await connect();
    expect(client.getInstructions()).toBe(MCP_INSTRUCTIONS);
  });

  it('offers the read tools, read-only, and no tool that reveals a value', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'list_variables',
        'get_value',
        'check',
        'history',
        'get_schema',
      ]),
    );
    expect(names.some((name) => /reveal/i.test(name))).toBe(false);
    for (const tool of tools.filter((tool) =>
      [
        'list_variables',
        'get_value',
        'check',
        'history',
        'get_schema',
      ].includes(tool.name),
    ))
      expect(tool.annotations?.readOnlyHint).toBe(true);
  });

  it('lists the variables with the secret masked', async () => {
    await writeEnv(`HOST=example.test\nPORT=8080\nAPI_KEY=${SECRET}\n`);
    const client = await connect();
    const result = await call(client, 'list_variables');
    expect(result.isError).toBe(false);
    const rows = JSON.parse(result.text) as { key: string; value?: string }[];
    expect(rows.find((row) => row.key === 'HOST')?.value).toBe('example.test');
    expect(rows.find((row) => row.key === 'API_KEY')?.value).not.toBe(SECRET);
    expect(result.text).not.toContain(SECRET);
  });

  it("gives a value, and only a secret's mask", async () => {
    await writeEnv(`HOST=example.test\nAPI_KEY=${SECRET}\n`);
    const client = await connect();
    const host = await call(client, 'get_value', { key: 'HOST' });
    expect(JSON.parse(host.text)).toMatchObject({
      key: 'HOST',
      value: 'example.test',
      set: true,
    });
    const secret = await call(client, 'get_value', { key: 'API_KEY' });
    expect(secret.isError).toBe(false);
    expect(JSON.parse(secret.text)).toMatchObject({
      key: 'API_KEY',
      set: true,
    });
    expect(secret.text).not.toContain(SECRET);
  });

  it('refuses a key that is no variable name', async () => {
    const client = await connect();
    const result = await call(client, 'get_value', { key: '--reveal' });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/variable name/);
  });

  it('refuses a file that is not in the schema', async () => {
    const client = await connect();
    const result = await call(client, 'list_variables', { file: '.env.other' });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/is not in the schema/);
  });

  it('checks, masking an invalid secret', async () => {
    await writeEnv(`HOST=example.test\nPORT=99999\nAPI_KEY=${SECRET}\n`);
    const client = await connect();
    const result = await call(client, 'check');
    expect(result.isError).toBe(true);
    const report = JSON.parse(result.text.split('\n')[0]!) as { ok: boolean };
    expect(report.ok).toBe(false);
    expect(result.text).toMatch(/PORT/);
    expect(result.text).not.toContain(SECRET);
  });

  it('reads the history with the secret masked', async () => {
    await writeEnv('HOST=example.test\n');
    const set = await run(['set', '--ci', '--stdin', 'API_KEY'], {
      cwd: dirs.root,
      stdin: SECRET,
    });
    expect(set.code).toBe(0);
    const client = await connect();
    const result = await call(client, 'history');
    expect(result.isError).toBe(false);
    expect(result.text).toMatch(/API_KEY/);
    expect(result.text).not.toContain(SECRET);
  });

  it('reads the schema with its fingerprint', async () => {
    const client = await connect();
    const result = await call(client, 'get_schema');
    const schema = JSON.parse(result.text) as {
      path: string;
      fingerprint: string;
      text: string;
    };
    expect(schema.path).toBe(join(dirs.root, 'env.schema.json'));
    expect(JSON.parse(schema.text)).toEqual(SCHEMA);
    expect(schema.fingerprint).toMatch(/\S/);
  });

  it('answers an invalid schema as an error', async () => {
    await writeFile(join(dirs.root, 'env.schema.json'), '{');
    const client = await connect();
    const result = await call(client, 'list_variables');
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/invalid schema/);
  });
});
