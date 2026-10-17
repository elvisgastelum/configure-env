import { describe, expect, it } from 'vite-plus/test';
import { jsonPathPosition, parseIssuePath } from './source-map.ts';

const SCHEMA = [
  '{',
  '  "version": 1,',
  '  "variables": {',
  '    "PORT": { "type": "port", "default": 3000 },',
  '    "API_URL": {',
  '      "type": "url"',
  '    },',
  '    "weird key": { "type": "string" }',
  '  },',
  '  "files": [',
  '    { "path": ".env", "variables": "*" },',
  '    {',
  '      "path": "config/app.env",',
  '      "variables": ["PORT", "API_URL"]',
  '    }',
  '  ]',
  '}',
  '',
].join('\n');

describe('parseIssuePath', () => {
  it('reads the paths the schema errors give', () => {
    expect(parseIssuePath('(root)')).toEqual([]);
    expect(parseIssuePath('version')).toEqual(['version']);
    expect(parseIssuePath('files[1].variables[0]')).toEqual([
      'files',
      1,
      'variables',
      0,
    ]);
    expect(parseIssuePath('variables["weird key"].type')).toEqual([
      'variables',
      'weird key',
      'type',
    ]);
    expect(parseIssuePath('[0]')).toEqual([0]);
  });

  it('refuses text that is not such a path', () => {
    expect(parseIssuePath('files[x]')).toBeUndefined();
    expect(parseIssuePath('files..a')).toBeUndefined();
    expect(parseIssuePath('variables["open')).toBeUndefined();
  });
});

describe('jsonPathPosition', () => {
  it('points at the key of an object member', () => {
    expect(jsonPathPosition(SCHEMA, 'version')).toEqual({
      line: 2,
      column: 3,
    });
    expect(jsonPathPosition(SCHEMA, 'variables.API_URL')).toEqual({
      line: 5,
      column: 5,
    });
    expect(jsonPathPosition(SCHEMA, 'variables.API_URL.type')).toEqual({
      line: 6,
      column: 7,
    });
    expect(jsonPathPosition(SCHEMA, 'variables.PORT.default')).toEqual({
      line: 4,
      column: 31,
    });
    expect(jsonPathPosition(SCHEMA, 'variables["weird key"].type')).toEqual({
      line: 8,
      column: 20,
    });
  });

  it('points at the value of an array element', () => {
    expect(jsonPathPosition(SCHEMA, 'files[1]')).toEqual({
      line: 12,
      column: 5,
    });
    expect(jsonPathPosition(SCHEMA, 'files[1].variables[1]')).toEqual({
      line: 14,
      column: 29,
    });
  });

  it('falls back to the deepest member that exists', () => {
    // A missing required field is reported at a path the file lacks.
    expect(jsonPathPosition(SCHEMA, 'variables.API_URL.required')).toEqual({
      line: 5,
      column: 5,
    });
    expect(jsonPathPosition(SCHEMA, 'files[7].path')).toEqual({
      line: 10,
      column: 3,
    });
  });

  it('gives the start for the root and for unknown paths', () => {
    expect(jsonPathPosition(SCHEMA, '(root)')).toEqual({ line: 1, column: 1 });
    expect(jsonPathPosition(SCHEMA, 'nope')).toEqual({ line: 1, column: 1 });
    expect(jsonPathPosition('\n\n  {"a": 1}', '(root)')).toEqual({
      line: 3,
      column: 3,
    });
  });

  it('reads the last of repeated keys, as JSON.parse does', () => {
    expect(jsonPathPosition('{"a": 1,\n "a": 2}', 'a')).toEqual({
      line: 2,
      column: 2,
    });
  });

  it('handles CRLF, a byte order mark and escaped keys', () => {
    const text = '\uFEFF{\r\n  "a\\"b": {\r\n    "c": 1\r\n  }\r\n}\r\n';
    expect(jsonPathPosition(text, 'a\\"b')).toBeUndefined();
    expect(jsonPathPosition(text, '["a\\"b"].c')).toEqual({
      line: 3,
      column: 5,
    });
  });

  it('gives no position for text that is not JSON or a path it cannot read', () => {
    expect(jsonPathPosition('{"a": ', 'a')).toBeUndefined();
    expect(jsonPathPosition('{"a": 1} x', 'a')).toBeUndefined();
    expect(jsonPathPosition(SCHEMA, 'files[x]')).toBeUndefined();
  });
});
