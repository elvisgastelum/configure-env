// Writes the API's OpenAPI document to the given path (stdout without one).
// packages/api-client generates its client from it (pnpm gen:api).

import { writeFile } from 'node:fs/promises';
import { buildOpenApiDocument } from '../src/server.ts';

const json = `${JSON.stringify(await buildOpenApiDocument(), null, 2)}\n`;
const [path] = process.argv.slice(2);
if (path) await writeFile(path, json);
else process.stdout.write(json);
