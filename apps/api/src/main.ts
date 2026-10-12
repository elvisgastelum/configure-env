// Runs the API standalone, with a fresh random token, and prints the launch
// URL. `configure-env serve` calls createServer in-process instead.
//
//   CONFIGURE_ENV_ROOT    the project root (default: the current directory)
//   CONFIGURE_ENV_SCHEMA  the schema path (default env.schema.json)
//   CONFIGURE_ENV_HOST    the address to bind (default 127.0.0.1)
//   CONFIGURE_ENV_PORT    the port (default 0: a free one)

import { randomBytes } from 'node:crypto';
import { DEFAULT_SCHEMA_PATH } from '@configure-env/core';
import { createServer } from './server.ts';

const env = process.env;
const server = await createServer({
  root: env.CONFIGURE_ENV_ROOT ?? process.cwd(),
  schemaPath: env.CONFIGURE_ENV_SCHEMA ?? DEFAULT_SCHEMA_PATH,
  ...(env.CONFIGURE_ENV_HOST ? { host: env.CONFIGURE_ENV_HOST } : {}),
  port: Number(env.CONFIGURE_ENV_PORT ?? 0),
  token: randomBytes(32).toString('base64url'),
});
process.stdout.write(
  `configure-env API on ${server.url}\nOpen ${server.launchUrl}\n`,
);

for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => void server.close().then(() => process.exit(0)));
