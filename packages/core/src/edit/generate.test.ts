import { describe, expect, it } from 'vite-plus/test';
import type { VariableSpec } from '../schema/definition.ts';
import { validateValue } from '../schema/values.ts';
import {
  GENERATED_BYTES,
  GENERATED_LENGTH,
  generatableProblem,
  generateValue,
} from './generate.ts';

const secret = (extra: Partial<VariableSpec> = {}) =>
  ({
    type: 'string',
    required: false,
    secret: true,
    ...extra,
  }) as VariableSpec;

const value = (spec: VariableSpec) => {
  const result = generateValue(spec);
  if (!result.ok) throw new Error(result.message);
  return result.value;
};

describe('generatableProblem', () => {
  it('takes a declared secret string', () => {
    expect(generatableProblem(secret(), true)).toBeUndefined();
  });

  it('refuses an undeclared key, a plain string and another type', () => {
    expect(generatableProblem(undefined, false)).toBe(
      'is not declared in the schema',
    );
    expect(generatableProblem(secret({ secret: false }), true)).toMatch(
      /secret string/,
    );
    expect(
      generatableProblem(
        { type: 'port', required: false, secret: true } as VariableSpec,
        true,
      ),
    ).toMatch(/secret string/);
  });
});

describe('generateValue', () => {
  it('makes a random base64url value of the default length', () => {
    const first = value(secret());
    expect(first).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(first).toHaveLength(GENERATED_LENGTH);
    expect(value(secret())).not.toBe(first);
  });

  it('follows minLength and maxLength', () => {
    expect(value(secret({ minLength: 64 }))).toHaveLength(64);
    expect(value(secret({ maxLength: 20 }))).toHaveLength(20);
  });

  it('refuses a maxLength too short for a secret', () => {
    expect(generateValue(secret({ maxLength: 8 }))).toEqual({
      ok: false,
      message: expect.stringMatching(/maxLength 8 is too short/),
    });
  });

  it.each(['base64', 'hex'] as const)(
    'makes random bytes in %s',
    (encoding) => {
      const spec = secret({ encoding });
      const made = value(spec);
      expect(Buffer.from(made, encoding)).toHaveLength(GENERATED_BYTES);
      expect(validateValue(spec, made).ok).toBe(true);
    },
  );

  it('makes `bytes` bytes when the schema sets them', () => {
    const made = value(secret({ encoding: 'hex', bytes: 24 }));
    expect(made).toHaveLength(48);
  });

  it('refuses too few bytes', () => {
    expect(generateValue(secret({ encoding: 'hex', bytes: 8 }))).toEqual({
      ok: false,
      message: expect.stringMatching(/bytes 8 is too short/),
    });
  });

  it('gives up on a pattern random values never match', () => {
    expect(generateValue(secret({ pattern: '^never$' }))).toEqual({
      ok: false,
      message: expect.stringMatching(/cannot generate a value/),
    });
  });
});
