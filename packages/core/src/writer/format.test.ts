import { describe, expect, it } from 'vitest';
import { formatJson } from './format.ts';

const stringify = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

describe('formatJson', () => {
  it('writes 2-space JSON with a trailing newline when there is no previous text', () => {
    const value = { version: 1, variables: { A: { type: 'string' } } };
    expect(formatJson(value)).toBe(stringify(value));
  });

  it('returns the previous text byte for byte when nothing changed', () => {
    const previous =
      '﻿{\n    "version":1,\r\n  "files": [ ],\n  "x": [1, 2,3]\n}\n\n';
    const value = JSON.parse(previous.slice(1)) as unknown;
    expect(formatJson(value, previous)).toBe(previous);
  });

  it('keeps unchanged subtrees as they were written and rewrites only the change', () => {
    const previous = [
      '{',
      '  "$schema": "https://example.com/s.json",',
      '  "version": 1,',
      '  "variables": {',
      '    "A": { "type": "string", "secret": true },',
      '    "B": {"type":"port"}',
      '  },',
      '  "files": [',
      '    { "path": ".env", "policy": "generate", "variables": ["A", "B"] }',
      '  ]',
      '}',
      '',
    ].join('\n');
    const value = JSON.parse(previous) as {
      variables: Record<string, Record<string, unknown>>;
    };
    value.variables.B = { type: 'port', default: 80 };
    expect(formatJson(value, previous)).toBe(
      previous.replace('{"type":"port"}', '{ "type": "port", "default": 80 }'),
    );
  });

  it('expands a changed container that was written over several lines', () => {
    const previous = stringify({ a: { b: 1 }, c: 2 });
    expect(formatJson({ a: { b: 1, d: [true] }, c: 2 }, previous)).toBe(
      stringify({ a: { b: 1, d: [true] }, c: 2 }),
    );
  });

  it('keeps the key order it is given, so a reorder is written', () => {
    const previous = stringify({ a: 1, b: 2 });
    expect(formatJson({ b: 2, a: 1 }, previous)).toBe(
      stringify({ b: 2, a: 1 }),
    );
  });

  it('reuses the text of a renamed key and of array items that moved', () => {
    const previous =
      '{\n  "OLD": { "type": "port" },\n  "list": [{ "a": 1 }, { "b": 2 }]\n}\n';
    expect(
      formatJson({ NEW: { type: 'port' }, list: [{ b: 2 }] }, previous),
    ).toBe('{\n  "NEW": { "type": "port" },\n  "list": [{ "b": 2 }]\n}\n');
  });

  it('keeps the indentation unit and line endings of the previous text', () => {
    const previous = '{\r\n\t"a": 1\r\n}\r\n';
    expect(formatJson({ a: 1, b: [2] }, previous)).toBe(
      '{\r\n\t"a": 1,\r\n\t"b": [\r\n\t\t2\r\n\t]\r\n}\r\n',
    );
  });

  it('keeps a missing trailing newline missing', () => {
    expect(formatJson({ a: 2 }, '{\n  "a": 1\n}')).toBe('{\n  "a": 2\n}');
  });

  it('writes empty containers compactly', () => {
    expect(formatJson({ a: {}, b: [] })).toBe('{\n  "a": {},\n  "b": []\n}\n');
  });

  it('ignores previous text that is not JSON', () => {
    expect(formatJson({ a: 1 }, '{ nope')).toBe(stringify({ a: 1 }));
  });

  it('leaves out undefined fields, as JSON.stringify does', () => {
    const previous = stringify({ a: 1 });
    expect(formatJson({ a: 1, b: undefined }, previous)).toBe(previous);
  });

  it('escapes strings and keys as JSON does', () => {
    const value = { 'a "b"': 'line\nbreak  ' };
    expect(formatJson(value)).toBe(stringify(value));
  });
});
