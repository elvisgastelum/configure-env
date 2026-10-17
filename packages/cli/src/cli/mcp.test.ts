// `configure-env mcp`: the tools an agent calls, through a real MCP client.
// No tool output ever holds a secret's value.

import { readFile, writeFile } from 'node:fs/promises';
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
    API_KEY: { type: 'string', secret: true, required: true },
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
const readEnv = () => readFile(join(dirs.root, '.env'), 'utf8');

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

describe('the MCP write tools', () => {
  it('sets values, validated, keeping the other lines', async () => {
    await writeEnv('# keep me\nHOST=old.test\n');
    const client = await connect();
    const result = await call(client, 'set_values', {
      values: { HOST: 'new.test', PORT: '9000' },
    });
    expect(result.isError).toBe(false);
    const env = await readEnv();
    expect(env).toContain('# keep me');
    expect(env).toMatch(/^HOST=new\.test$/m);
    expect(env).toMatch(/^PORT=9000$/m);
  });

  it('refuses an invalid value and writes nothing', async () => {
    await writeEnv('PORT=8080\n');
    const client = await connect();
    const result = await call(client, 'set_values', {
      values: { PORT: 'not-a-port' },
    });
    expect(result.isError).toBe(true);
    expect(await readEnv()).toBe('PORT=8080\n');
  });

  it('refuses a secret and points to generate_secret and request_secret', async () => {
    await writeEnv('HOST=a.test\n');
    const client = await connect();
    const result = await call(client, 'set_values', {
      values: { HOST: 'b.test', API_KEY: SECRET },
    });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/API_KEY: secret/);
    expect(result.text).toMatch(/generate_secret/);
    expect(result.text).toMatch(/request_secret/);
    expect(result.text).not.toContain(SECRET);
    expect(await readEnv()).toBe('HOST=a.test\n');
  });

  it('generates a secret without returning it', async () => {
    await writeEnv('HOST=a.test\n');
    const client = await connect();
    const result = await call(client, 'generate_secret', { keys: ['API_KEY'] });
    expect(result.isError).toBe(false);
    const value = /^API_KEY=(.+)$/m.exec(await readEnv())?.[1];
    expect(value).toBeDefined();
    expect(value!.length).toBeGreaterThanOrEqual(16);
    expect(result.text).not.toContain(value!);
  });

  it('hands the user the command to type a secret, changing nothing', async () => {
    await writeEnv('HOST=a.test\n');
    const client = await connect();
    const result = await call(client, 'request_secret', {
      key: 'API_KEY',
      file: '.env',
    });
    expect(result.isError).toBe(false);
    const root = dirs.root;
    expect(JSON.parse(result.text)).toMatchObject({
      key: 'API_KEY',
      command: `configure-env set --root ${root} --file .env --prompt API_KEY`,
      npx: `npx @elvisgastelum/configure-env set --root ${root} --file .env --prompt API_KEY`,
    });
    expect(await readEnv()).toBe('HOST=a.test\n');
  });

  it('hands a command that runs from any folder, with the state the server uses', async () => {
    const server = createMcpServer({
      cwd: dirs.root,
      env: {},
      version: '0',
      state: 'custom/state.db',
    });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '0.0.0' });
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
    clients.push(client);
    const result = await call(client, 'request_secret', {
      key: 'API_KEY',
      file: '.env',
    });
    const { command } = JSON.parse(result.text) as { command: string };
    const root = dirs.root;
    expect(command).toBe(
      `configure-env set --root ${root} --state ${join(root, 'custom/state.db')} --file .env --create --prompt API_KEY`,
    );
  });

  it('refuses to request a secret for a file that is not in the schema', async () => {
    const client = await connect();
    const result = await call(client, 'request_secret', {
      key: 'API_KEY',
      file: '.env.other',
    });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/\.env\.other: is not in the schema/);
  });

  it('refuses to request a variable the schema does not declare', async () => {
    const client = await connect();
    const result = await call(client, 'request_secret', { key: 'NOPE' });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/NOPE: is not in the schema/);
  });

  it('removes variables, marked destructive', async () => {
    await writeEnv('HOST=a.test\nPORT=8080\n');
    const client = await connect();
    const { tools } = await client.listTools();
    expect(
      tools.find((tool) => tool.name === 'unset')?.annotations?.destructiveHint,
    ).toBe(true);
    const result = await call(client, 'unset', { keys: ['PORT'] });
    expect(result.isError).toBe(false);
    expect(await readEnv()).toBe('HOST=a.test\n');
  });

  it('applies the schema, deferring a secret to the user', async () => {
    const client = await connect();
    const result = await call(client, 'apply', { defer: ['API_KEY'] });
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.text)).toMatchObject({ deferred: ['API_KEY'] });
    expect(await readEnv()).toMatch(/^HOST=localhost$/m);
    expect(await readEnv()).not.toMatch(/^API_KEY=./m);
  });

  it('applies the schema, generating a secret it never returns', async () => {
    const client = await connect();
    const result = await call(client, 'apply', { generate: ['API_KEY'] });
    expect(result.isError).toBe(false);
    const value = /^API_KEY=(.+)$/m.exec(await readEnv())?.[1];
    expect(value).toBeDefined();
    expect(result.text).not.toContain(value!);
  });

  it('fills a deferred secret with generate_secret', async () => {
    const client = await connect();
    await call(client, 'apply', { defer: ['API_KEY'] });
    const result = await call(client, 'generate_secret', { keys: ['API_KEY'] });
    expect(result.isError).toBe(false);
    const value = /^API_KEY=(.+)$/m.exec(await readEnv())?.[1];
    expect(value).toBeDefined();
    expect(result.text).not.toContain(value!);
  });

  it('fixes the git-ignore lines check reports', async () => {
    await writeEnv('HOST=a.test\n');
    const git = await import('node:child_process');
    git.execFileSync('git', ['init', '-q'], { cwd: dirs.root });
    const client = await connect();
    const before = await call(client, 'check');
    expect(before.text).toMatch(/gitignore/i);
    const result = await call(client, 'fix_gitignore');
    expect(await readFile(join(dirs.root, '.gitignore'), 'utf8')).toMatch(
      /^\/\.env$/m,
    );
    expect(result.text).toMatch(/fixed/);
  });

  it('updates the schema at the fingerprint it was read with', async () => {
    const client = await connect();
    const read = JSON.parse((await call(client, 'get_schema')).text) as {
      fingerprint: string;
    };
    const document = {
      ...SCHEMA,
      variables: { ...SCHEMA.variables, MODE: { type: 'string' } },
    };
    const result = await call(client, 'update_schema', {
      document,
      fingerprint: read.fingerprint,
    });
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.text)).toMatchObject({ ok: true, written: true });
    const saved = JSON.parse(
      await readFile(join(dirs.root, 'env.schema.json'), 'utf8'),
    ) as { variables: Record<string, unknown> };
    expect(saved.variables).toHaveProperty('MODE');
    const history = await call(client, 'history');
    expect(history.text).toMatch(/schema/);

    const stale = await call(client, 'update_schema', {
      document,
      fingerprint: read.fingerprint,
    });
    expect(stale.isError).toBe(true);
    expect(JSON.parse(stale.text)).toMatchObject({ ok: false, kind: 'stale' });
  });

  it('refuses an invalid schema document and writes nothing', async () => {
    const client = await connect();
    const read = JSON.parse((await call(client, 'get_schema')).text) as {
      fingerprint: string;
      text: string;
    };
    const result = await call(client, 'update_schema', {
      document: {
        ...SCHEMA,
        variables: { ...SCHEMA.variables, HOST: { type: 'nope' } },
      },
      fingerprint: read.fingerprint,
    });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.text)).toMatchObject({
      ok: false,
      kind: 'invalid',
    });
    expect(await readFile(join(dirs.root, 'env.schema.json'), 'utf8')).toBe(
      read.text,
    );
  });

  it('refuses a schema that would unmask a secret, writing nothing', async () => {
    await writeEnv(`HOST=a.test\nAPI_KEY=${SECRET}\n`);
    const client = await connect();
    const read = JSON.parse((await call(client, 'get_schema')).text) as {
      fingerprint: string;
      text: string;
    };
    const others = { HOST: SCHEMA.variables.HOST, PORT: SCHEMA.variables.PORT };
    for (const variables of [
      { ...others, API_KEY: { type: 'string' } },
      { ...others, API_KEY: { type: 'string', secret: false } },
      others,
    ]) {
      const result = await call(client, 'update_schema', {
        document: { ...SCHEMA, variables },
        fingerprint: read.fingerprint,
      });
      expect(result.isError).toBe(true);
      expect(JSON.parse(result.text)).toMatchObject({
        ok: false,
        kind: 'secret',
      });
      expect(result.text).toMatch(/would unmask API_KEY/);
    }
    expect(await readFile(join(dirs.root, 'env.schema.json'), 'utf8')).toBe(
      read.text,
    );
    expect(
      (await call(client, 'get_value', { key: 'API_KEY' })).text,
    ).not.toContain(SECRET);
  });
});

describe('a secret in a file whose variables leave it out', () => {
  const split = useProject({
    version: 1,
    variables: {
      HOST: { type: 'string' },
      API_KEY: { type: 'string', secret: true },
    },
    files: [
      { path: '.env', policy: 'merge', variables: ['HOST'] },
      { path: '.env.secret', policy: 'merge', variables: ['API_KEY'] },
    ],
  });

  it('stays masked in every read tool', async () => {
    await writeFile(
      join(split.root, '.env'),
      `HOST=a.test\nAPI_KEY=${SECRET}\n`,
    );
    const server = createMcpServer({ cwd: split.root, env: {}, version: '0' });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '0.0.0' });
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
    clients.push(client);
    for (const [name, args] of [
      ['get_value', { key: 'API_KEY', file: '.env' }],
      ['list_variables', {}],
      ['check', { strict: true }],
    ] as const) {
      const result = await call(client, name, args);
      expect(result.text, name).not.toContain(SECRET);
    }
    const got = await call(client, 'get_value', {
      key: 'API_KEY',
      file: '.env',
    });
    expect(JSON.parse(got.text)).toMatchObject({
      key: 'API_KEY',
      masked: '••••',
    });
  });
});

describe('the masking of every answer', () => {
  it('masks a key the schema does not declare', async () => {
    const undeclared = ['tok', 'q'.repeat(20)].join('-');
    await writeEnv(`HOST=a.test\nLEGACY_TOKEN=${undeclared}\n`);
    const client = await connect();
    for (const [name, args] of [
      ['get_value', { key: 'LEGACY_TOKEN' }],
      ['list_variables', {}],
      ['check', {}],
    ] as const) {
      const result = await call(client, name, args);
      expect(result.text, name).not.toContain(undeclared);
    }
    const got = await call(client, 'get_value', { key: 'LEGACY_TOKEN' });
    expect(JSON.parse(got.text)).toMatchObject({
      key: 'LEGACY_TOKEN',
      masked: '••••',
    });
    const host = await call(client, 'get_value', { key: 'HOST' });
    expect(JSON.parse(host.text)).toMatchObject({ value: 'a.test' });
  });

  it('masks a value under 4 characters, or a short undeclared one, only where it is whole', async () => {
    await writeEnv('HOST=localhost\nAPI_KEY=loc\nMODE_X=host\n');
    const client = await connect();
    const host = await call(client, 'get_value', { key: 'HOST' });
    expect(JSON.parse(host.text)).toMatchObject({ value: 'localhost' });
    const mode = await call(client, 'get_value', { key: 'MODE_X' });
    expect(JSON.parse(mode.text)).toMatchObject({ masked: '••••' });
    const rows = JSON.parse((await call(client, 'list_variables')).text) as {
      key: string;
      value?: string;
      masked?: string;
    }[];
    expect(rows.find((row) => row.key === 'HOST')?.value).toBe('localhost');
    expect(rows.find((row) => row.key === 'API_KEY')?.value).toBeUndefined();
  });

  it('masks a short secret inside a non-secret value', async () => {
    await writeEnv('HOST=http://u:zq7Kx@h/\nAPI_KEY=zq7Kx\n');
    const client = await connect();
    for (const name of ['list_variables', 'check']) {
      const result = await call(client, name);
      expect(result.text, name).not.toContain('zq7Kx');
    }
    const host = await call(client, 'get_value', { key: 'HOST' });
    expect(JSON.parse(host.text)).toMatchObject({ value: 'http://u:••••@h/' });
  });

  it('masks an undeclared value only in its own entry', async () => {
    await writeFile(
      join(dirs.root, 'env.schema.json'),
      JSON.stringify({
        ...SCHEMA,
        files: [{ path: '.env.development', policy: 'merge', variables: '*' }],
      }),
    );
    await writeFile(
      join(dirs.root, '.env.development'),
      'HOST=a.test\nPORT=3000\nNODE_ENV=development\nDEBUG_PORT=3000\n',
    );
    const client = await connect();
    const rows = JSON.parse((await call(client, 'list_variables')).text) as {
      file: string;
      key: string;
      value?: string;
      masked?: string;
    }[];
    expect(rows.every((row) => row.file === '.env.development')).toBe(true);
    expect(rows.find((row) => row.key === 'PORT')?.value).toBe('3000');
    expect(rows.find((row) => row.key === 'NODE_ENV')).toMatchObject({
      masked: '••••',
    });
    expect(rows.find((row) => row.key === 'DEBUG_PORT')?.value).toBeUndefined();
  });

  it('masks the history previews of a key the schema no longer declares', async () => {
    const legacy = ['legacy', 'v'.repeat(12)].join('-');
    await writeFile(
      join(dirs.root, 'env.schema.json'),
      JSON.stringify({
        ...SCHEMA,
        variables: { ...SCHEMA.variables, LEGACY: { type: 'string' } },
      }),
    );
    await writeEnv('HOST=a.test\n');
    const set = await run(['set', '--ci', `LEGACY=${legacy}`], {
      cwd: dirs.root,
    });
    expect(set.code).toBe(0);
    await writeFile(join(dirs.root, 'env.schema.json'), JSON.stringify(SCHEMA));
    const client = await connect();
    const result = await call(client, 'history');
    expect(result.text).toMatch(/LEGACY/);
    expect(result.text).not.toContain(legacy);
  });

  it('withholds the output when the schema cannot be read to mask it', async () => {
    await writeEnv(`HOST=a.test\nAPI_KEY=${SECRET}\n`);
    const client = await connect();
    await writeFile(join(dirs.root, 'env.schema.json'), '{');
    for (const name of ['list_variables', 'check', 'history']) {
      const result = await call(client, name);
      expect(result.text, name).not.toContain(SECRET);
      expect(result.text, name).not.toContain('a.test');
    }
  });
});

describe('update_schema and the keys the env files hold', () => {
  const held = ['tok', 'w'.repeat(20)].join('-');

  /** The schema's fingerprint, read through get_schema. */
  async function fingerprint(client: Client): Promise<string> {
    return (
      JSON.parse((await call(client, 'get_schema')).text) as {
        fingerprint: string;
      }
    ).fingerprint;
  }

  it('refuses to declare a held key without secret: true', async () => {
    await writeEnv(`HOST=a.test\nLEGACY_TOKEN=${held}\n`);
    const client = await connect();
    const result = await call(client, 'update_schema', {
      document: {
        ...SCHEMA,
        variables: { ...SCHEMA.variables, LEGACY_TOKEN: { type: 'string' } },
      },
      fingerprint: await fingerprint(client),
    });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.text)).toMatchObject({ kind: 'secret' });
    expect(result.text).toMatch(/would unmask LEGACY_TOKEN/);
    expect(result.text).not.toContain(held);
  });

  it('declares a held key that stays secret', async () => {
    await writeEnv(`HOST=a.test\nLEGACY_TOKEN=${held}\n`);
    const client = await connect();
    const result = await call(client, 'update_schema', {
      document: {
        ...SCHEMA,
        variables: {
          ...SCHEMA.variables,
          LEGACY_TOKEN: { type: 'string', secret: true },
        },
      },
      fingerprint: await fingerprint(client),
    });
    expect(result.isError).toBe(false);
    const got = await call(client, 'get_value', { key: 'LEGACY_TOKEN' });
    expect(got.text).not.toContain(held);
  });

  it('refuses a new file whose held keys it declares without secret: true', async () => {
    await writeFile(join(dirs.root, '.npmrc.env'), `NPM_TOKEN=${held}\n`);
    const client = await connect();
    const result = await call(client, 'update_schema', {
      document: {
        ...SCHEMA,
        variables: { ...SCHEMA.variables, NPM_TOKEN: { type: 'string' } },
        files: [
          ...SCHEMA.files,
          { path: '.npmrc.env', policy: 'merge', variables: ['NPM_TOKEN'] },
        ],
      },
      fingerprint: await fingerprint(client),
    });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/would unmask NPM_TOKEN/);
  });

  it('refuses a new file that holds a key declared non-secret earlier', async () => {
    const client = await connect();
    const declared = await call(client, 'update_schema', {
      document: {
        ...SCHEMA,
        variables: { ...SCHEMA.variables, KEYQ: { type: 'string' } },
      },
      fingerprint: await fingerprint(client),
    });
    expect(declared.isError).toBe(false);
    await writeFile(join(dirs.root, '.env.prod'), `KEYQ=${held}\n`);
    const result = await call(client, 'update_schema', {
      document: {
        ...SCHEMA,
        variables: { ...SCHEMA.variables, KEYQ: { type: 'string' } },
        files: [
          ...SCHEMA.files,
          { path: '.env.prod', policy: 'merge', variables: '*' },
        ],
      },
      fingerprint: await fingerprint(client),
    });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/would unmask KEYQ/);
    expect(result.text).toMatch(/also when the edit adds that file/);
  });

  it('adds a non-secret variable no file holds yet', async () => {
    await writeEnv('HOST=a.test\n');
    const client = await connect();
    const result = await call(client, 'update_schema', {
      document: {
        ...SCHEMA,
        variables: { ...SCHEMA.variables, MODE: { type: 'string' } },
      },
      fingerprint: await fingerprint(client),
    });
    expect(result.isError).toBe(false);
  });
});
