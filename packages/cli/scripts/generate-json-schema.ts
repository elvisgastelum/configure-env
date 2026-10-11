// Writes schema/env.schema.v1.json from the zod definition.
//
//   pnpm schema:generate   write the file
//   pnpm schema:check      exit 1 when the committed file is stale

import { readFile, writeFile } from 'node:fs/promises';
import { JSON_SCHEMA_PATH, renderJsonSchema } from '@configure-env/core';

const target = new URL(`../${JSON_SCHEMA_PATH}`, import.meta.url);
const content = renderJsonSchema();

if (process.argv.includes('--check')) {
  const committed = await readFile(target, 'utf8').catch(() => undefined);
  if (committed !== content) {
    console.error(
      `${JSON_SCHEMA_PATH} is stale: run \`pnpm schema:generate\` and commit it.`,
    );
    process.exit(1);
  }
  console.log(`${JSON_SCHEMA_PATH} is up to date.`);
} else {
  await writeFile(target, content);
  console.log(`Wrote ${JSON_SCHEMA_PATH}.`);
}
