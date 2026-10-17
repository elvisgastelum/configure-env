// `configure-env mcp`: serves the project's env files to an agent over the
// Model Context Protocol, on stdin and stdout, until the client closes them.
// The server (mcp-server.ts) and the MCP SDK load only for this command.

import { contextOf, parseCommand } from './common.ts';
import { MCP_HELP, VERSION } from './help.ts';
import type { Io } from './io.ts';

export async function mcpCommand(args: string[], io: Io): Promise<number> {
  const options = parseCommand(args, {});
  if (options.help) {
    io.stdout(MCP_HELP);
    return 0;
  }
  // Fails early, before the client connects, on a root that does not exist.
  await contextOf(io, options);
  const [{ createMcpServer }, { StdioServerTransport }] = await Promise.all([
    import('./mcp-server.ts'),
    import('@modelcontextprotocol/sdk/server/stdio.js'),
  ]);
  const server = createMcpServer({
    cwd: io.cwd,
    env: io.env,
    version: VERSION,
    ...(options.root === undefined ? {} : { root: options.root }),
    ...(options.schema === undefined ? {} : { schema: options.schema }),
    ...(options.state === undefined ? {} : { state: options.state }),
  });
  const transport = new StdioServerTransport();
  const closed = new Promise<void>((resolve) => {
    transport.onclose = resolve;
    process.stdin.once('end', resolve);
  });
  await server.connect(transport);
  await closed;
  await server.close();
  return 0;
}
