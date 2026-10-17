import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vite-plus/test';
import {
  JSON_SCHEMA_PATH,
  SCHEMA_ID,
  buildJsonSchema,
  loadSchema,
  renderJsonSchema,
} from '@configure-env/core';

// This package commits the generated schema and the example.
const repo = new URL('../', import.meta.url);

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
      ['deploy/.env.production.example', 'generate', undefined],
      ['.env.example', 'merge', undefined],
      ['.env', 'create-only', '600'],
    ]);
  });
});
