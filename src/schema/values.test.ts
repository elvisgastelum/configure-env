import { describe, expect, it } from 'vitest';
import { type VariableSpec, variableSpec } from './definition.ts';
import { validateValue } from './values.ts';

/** A spec with the definition's defaults applied, as a loaded schema has. */
const spec = (input: Record<string, unknown>): VariableSpec =>
  variableSpec.parse(input);

const ok = (value: unknown) => ({ ok: true, value });
const fails = (message: string | RegExp) => ({
  ok: false,
  error: expect.stringMatching(message),
});

describe('validateValue', () => {
  describe('empty and missing values', () => {
    const optional = spec({ type: 'port' });
    const required = spec({ type: 'port', required: true });

    it('accepts a missing optional value as null', () => {
      expect(validateValue(optional, undefined)).toEqual(ok(null));
    });

    it('accepts an empty optional value as null', () => {
      expect(validateValue(optional, '')).toEqual(ok(null));
    });

    it('rejects a missing required value', () => {
      expect(validateValue(required, undefined)).toEqual(fails(/required/));
    });

    it('rejects an empty required value', () => {
      expect(validateValue(required, '')).toEqual(fails(/required/));
    });

    it('accepts an empty required value when allowEmpty is set', () => {
      const lenient = spec({ type: 'port', required: true, allowEmpty: true });
      expect(validateValue(lenient, '')).toEqual(ok(null));
      expect(validateValue(lenient, undefined)).toEqual(fails(/required/));
    });

    it('rejects an empty optional value when allowEmpty is false', () => {
      const strict = spec({ type: 'string', allowEmpty: false });
      expect(validateValue(strict, '')).toEqual(fails(/empty/));
      expect(validateValue(strict, undefined)).toEqual(ok(null));
    });
  });

  describe('string', () => {
    const s = spec({
      type: 'string',
      minLength: 2,
      maxLength: 4,
      pattern: '^[a-z]+$',
    });

    it.each(['ab', 'abcd'])('accepts %j', (raw) => {
      expect(validateValue(s, raw)).toEqual(ok(raw));
    });

    it.each([
      ['a', /at least 2/],
      ['abcde', /at most 4/],
      ['AB', /must match/],
    ])('rejects %j', (raw, message) => {
      expect(validateValue(s, raw)).toEqual(fails(message));
    });

    it('uses patternMessage for a pattern mismatch', () => {
      const whatsapp = spec({
        type: 'string',
        pattern: '^(\\d{8,15}|off)?$',
        patternMessage: 'digits or off',
      });
      expect(validateValue(whatsapp, '5215555555555')).toEqual(
        ok('5215555555555'),
      );
      expect(validateValue(whatsapp, 'call me')).toEqual(
        fails(/digits or off/),
      );
    });

    it('counts characters, not UTF-16 units', () => {
      expect(
        validateValue(spec({ type: 'string', maxLength: 2 }), '😀😀'),
      ).toEqual(ok('😀😀'));
    });
  });

  describe('number', () => {
    const n = spec({ type: 'number', min: -1, max: 10 });

    it.each([
      ['0', 0],
      ['-1', -1],
      ['2.5', 2.5],
      ['.5', 0.5],
      ['1e1', 10],
    ])('accepts %j as %j', (raw, value) => {
      expect(validateValue(n, raw)).toEqual(ok(value));
    });

    it.each([
      ['abc', /must be a number/],
      [' 1', /must be a number/],
      ['0x10', /must be a number/],
      ['Infinity', /must be a number/],
      ['-2', /at least -1/],
      ['11', /at most 10/],
    ])('rejects %j', (raw, message) => {
      expect(validateValue(n, raw)).toEqual(fails(message));
    });
  });

  describe('integer', () => {
    const i = spec({ type: 'integer', min: 1 });

    it.each([
      ['1', 1],
      ['+42', 42],
    ])('accepts %j as %j', (raw, value) => {
      expect(validateValue(i, raw)).toEqual(ok(value));
    });

    it.each([
      ['1.5', /whole number/],
      ['0', /at least 1/],
      ['99999999999999999999', /whole number/],
    ])('rejects %j', (raw, message) => {
      expect(validateValue(i, raw)).toEqual(fails(message));
    });
  });

  describe('boolean', () => {
    const b = spec({ type: 'boolean' });

    it.each([
      ['true', true],
      ['FALSE', false],
      ['1', true],
      ['0', false],
      ['yes', true],
      ['no', false],
      ['on', true],
      ['off', false],
    ])('accepts %j as %j', (raw, value) => {
      expect(validateValue(b, raw)).toEqual(ok(value));
    });

    it('rejects anything else', () => {
      expect(validateValue(b, 'maybe')).toEqual(fails(/true or false/));
    });
  });

  describe('enum', () => {
    const e = spec({ type: 'enum', values: ['dev', 'prod'] });

    it('accepts a listed value', () => {
      expect(validateValue(e, 'prod')).toEqual(ok('prod'));
    });

    it('rejects an unlisted value, case-sensitively', () => {
      expect(validateValue(e, 'Prod')).toEqual(fails(/one of dev, prod/));
    });
  });

  describe('email', () => {
    const email = spec({ type: 'email' });

    it('accepts an address', () => {
      expect(validateValue(email, 'you@example.com')).toEqual(
        ok('you@example.com'),
      );
    });

    it.each(['you', 'you@', '@example.com'])('rejects %j', (raw) => {
      expect(validateValue(email, raw)).toEqual(fails(/email/));
    });
  });

  describe('url', () => {
    it('accepts any absolute URL without protocols', () => {
      const url = spec({ type: 'url' });
      expect(validateValue(url, 'ftp://files.example.com')).toEqual(
        ok('ftp://files.example.com'),
      );
      expect(validateValue(url, 'example.com')).toEqual(fails(/URL/));
    });

    it('limits the protocols when given', () => {
      const url = spec({ type: 'url', protocols: ['http', 'https:'] });
      expect(validateValue(url, 'https://example.com')).toEqual(
        ok('https://example.com'),
      );
      expect(validateValue(url, 'ftp://example.com')).toEqual(
        fails(/http, https/),
      );
    });
  });

  describe('host', () => {
    const host = spec({ type: 'host' });

    it.each(['localhost', 'web.internal', '192.168.1.70', '::1', 'fd7a::1'])(
      'accepts %j',
      (raw) => {
        expect(validateValue(host, raw)).toEqual(ok(raw));
      },
    );

    it.each(['bad host', '-leading.dash', 'trailing-.dash', 'a'.repeat(64)])(
      'rejects %j',
      (raw) => {
        expect(validateValue(host, raw)).toEqual(fails(/hostname/));
      },
    );
  });

  describe('ipv4', () => {
    const ipv4 = spec({ type: 'ipv4' });

    it('accepts an address', () => {
      expect(validateValue(ipv4, '100.64.0.1')).toEqual(ok('100.64.0.1'));
    });

    it.each(['256.0.0.1', '1.2.3', 'localhost', '::1'])('rejects %j', (raw) => {
      expect(validateValue(ipv4, raw)).toEqual(fails(/IPv4/));
    });
  });

  describe('port', () => {
    const port = spec({ type: 'port' });

    it.each([
      ['1', 1],
      ['8080', 8080],
      ['65535', 65535],
    ])('accepts %j as %j', (raw, value) => {
      expect(validateValue(port, raw)).toEqual(ok(value));
    });

    it.each(['0', '65536', '80.5', 'http', '-1'])('rejects %j', (raw) => {
      expect(validateValue(port, raw)).toEqual(fails(/1 and 65535/));
    });
  });

  describe('secrets', () => {
    it('never echoes the value in an error', () => {
      const token = spec({ type: 'string', secret: true, minLength: 20 });
      const result = validateValue(token, 'hunter2-hunter2');
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain('hunter2');
    });
  });
});
