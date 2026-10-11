import { describe, expect, it } from 'vitest';
import * as api from './index.ts';

describe('the programmatic API', () => {
  it('exports the schema, engine and dotenv functions', () => {
    for (const name of [
      'parseSchema',
      'parseSchemaText',
      'loadSchema',
      'planChanges',
      'applyPlan',
      'checkDrift',
      'parseDotenv',
      'serialize',
      'getValue',
      'setValue',
      'removeKey',
      'loadState',
      'writeState',
      'recordFingerprint',
      'matchesFingerprint',
      'main',
    ] as const) {
      expect(typeof api[name], name).toBe('function');
    }
  });

  it('parses a schema and edits dotenv text', () => {
    const result = api.parseSchema({
      version: 1,
      variables: { PORT: { type: 'port', default: 8080 } },
      files: [{ path: 'app.env', policy: 'generate', variables: '*' }],
    });
    expect(result.ok).toBe(true);

    const doc = api.parseDotenv('# comment\nPORT=1\n');
    api.setValue(doc, 'PORT', '9090');
    expect(api.serialize(doc)).toBe('# comment\nPORT=9090\n');
    expect(api.getValue(doc, 'PORT')).toBe('9090');
  });
});
