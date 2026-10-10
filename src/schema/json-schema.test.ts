import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { SCHEMA_ID } from './definition.ts';
import {
  JSON_SCHEMA_PATH,
  buildJsonSchema,
  renderJsonSchema,
} from './json-schema.ts';
import { loadSchema } from './load.ts';

const repo = new URL('../../', import.meta.url);

describe('the published JSON Schema', () => {
  it('is up to date with the zod definition (run `pnpm schema:generate`)', async () => {
    const committed = await readFile(new URL(JSON_SCHEMA_PATH, repo), 'utf8');
    expect(committed).toBe(renderJsonSchema());
  });

  it('carries its id, title and description', () => {
    expect(buildJsonSchema()).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: SCHEMA_ID,
      title: expect.any(String),
      description: expect.any(String),
      additionalProperties: false,
    });
  });
});

describe('examples/portfolio.env.schema.json', () => {
  it('loads', async () => {
    const result = await loadSchema(
      new URL('examples/portfolio.env.schema.json', repo).pathname,
    );
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(Object.keys(result.schema.variables)).toEqual([
      'WEB_HOST',
      'WEB_PORT',
      'VITE_CONTACT_EMAIL',
      'VITE_CONTACT_WHATSAPP',
      'COMPOSE_FILE',
      'COMPOSE_PROJECT_NAME',
      'IMAGE_TAG',
      'CADDY_ADDRESS',
    ]);
    expect(
      result.schema.files.map(({ path, policy, mode }) => [path, policy, mode]),
    ).toEqual([
      ['.env.example', 'merge', undefined],
      ['deploy/.env.production.example', 'generate', undefined],
      ['.env', 'create-only', '600'],
    ]);
  });
});
