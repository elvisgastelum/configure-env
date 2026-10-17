// Generates the client from the API: the OpenAPI document the server builds
// (openapi.json), then orval's fetch functions and React Query hooks
// (src/generated/), formatted with Oxfmt and the root vite.config.ts `fmt`
// options, as `vp fmt` formats them.
//
//   pnpm gen:api          write them
//   pnpm gen:api:check    fail when the committed files are out of date

import { execFileSync } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from 'orval';
import { format } from 'vite-plus/fmt';
import rootConfig from '../../../vite.config.ts';

const check = process.argv.includes('--check');
const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SPEC = 'openapi.json';
const GENERATED = 'src/generated';
const MUTATOR = 'src/fetcher.ts';

/** Every file under `dir`, relative to it, sorted. */
async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, {
    recursive: true,
    withFileTypes: true,
  }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)))
    .sort();
}

/** The generated files by path relative to the package, formatted. */
async function render(): Promise<Map<string, string>> {
  const scratch = await mkdtemp(join(tmpdir(), 'configure-env-api-client-'));
  try {
    // The API package builds the document: its Nest sources need its own
    // tsconfig (legacy decorators) to run.
    const spec = join(scratch, SPEC);
    execFileSync(
      'pnpm',
      ['--filter', '@configure-env/api', '--silent', 'openapi', spec],
      {
        stdio: 'inherit',
      },
    );
    // Every function goes through src/fetcher.ts: relative and same-origin
    // in the portal, against a target's URL and token in Node. The portal
    // gets the React Query hooks (api.ts); Node gets the plain functions
    // (client.ts), which never import React.
    // A copy beside the output, so the generated import is `../fetcher.ts`.
    const mutator = { path: join(scratch, MUTATOR), name: 'apiFetch' };
    await mkdir(dirname(mutator.path), { recursive: true });
    await writeFile(
      mutator.path,
      await readFile(join(packageDir, MUTATOR), 'utf8'),
    );
    for (const [file, client] of [
      ['api.ts', 'react-query'],
      ['client.ts', 'fetch'],
    ] as const)
      await generate({
        input: { target: spec },
        output: {
          target: join(scratch, GENERATED, file),
          client,
          httpClient: 'fetch',
          mode: 'single',
          override: { mutator },
        },
      });
    const files = new Map<string, string>([
      [SPEC, await readFile(spec, 'utf8')],
    ]);
    for (const file of await listFiles(join(scratch, GENERATED)))
      files.set(
        join(GENERATED, file),
        await readFile(join(scratch, GENERATED, file), 'utf8'),
      );
    for (const [path, content] of files) {
      const formatted = await format(path, content, rootConfig.fmt);
      if (formatted.errors.length)
        throw new Error(
          `Could not format ${path}: ${formatted.errors.map((error) => error.message).join('; ')}`,
        );
      files.set(path, formatted.code);
    }
    return files;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

const files = await render();
const existing = [
  ...(await listFiles(join(packageDir, GENERATED))).map((file) =>
    join(GENERATED, file),
  ),
];

if (check) {
  const stale: string[] = [];
  for (const [path, content] of files) {
    const current = await readFile(join(packageDir, path), 'utf8').catch(
      () => undefined,
    );
    if (current !== content) stale.push(path);
  }
  stale.push(...existing.filter((path) => !files.has(path)));
  if (stale.length) {
    console.error(
      `api-client is out of date: ${stale.join(', ')}\nRun pnpm gen:api and commit the result.`,
    );
    process.exit(1);
  }
  console.log('api-client is up to date.');
} else {
  for (const path of existing)
    if (!files.has(path)) await rm(join(packageDir, path));
  for (const [path, content] of files) {
    await mkdir(dirname(join(packageDir, path)), { recursive: true });
    await writeFile(join(packageDir, path), content);
  }
  console.log(`Wrote ${[...files.keys()].join(', ')}.`);
}
