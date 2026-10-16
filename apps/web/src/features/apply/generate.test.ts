import type { VariableSpec } from '@configure-env/api-client';
import { describe, expect, it } from 'vitest';
import { canGenerate, generateSecret } from './generate';

const secret = (spec: Partial<VariableSpec> = {}) =>
  ({
    type: 'string',
    required: false,
    secret: true,
    ...spec,
  }) as VariableSpec;

describe('generateSecret', () => {
  it('makes 48 base64url characters by default, new each time', () => {
    const first = generateSecret(secret());
    expect(first).toMatch(/^[A-Za-z0-9_-]{48}$/);
    expect(generateSecret(secret())).not.toBe(first);
  });

  it('follows minLength and maxLength', () => {
    expect(generateSecret(secret({ minLength: 64 }))).toHaveLength(64);
    expect(generateSecret(secret({ maxLength: 20 }))).toHaveLength(20);
    // Shorter than 16 is a weak secret: none is made.
    expect(generateSecret(secret({ maxLength: 8 }))).toBeUndefined();
  });

  it('makes bytes in the encoding', () => {
    expect(generateSecret(secret({ encoding: 'hex', bytes: 16 }))).toMatch(
      /^[0-9a-f]{32}$/,
    );
    expect(generateSecret(secret({ encoding: 'base64' }))).toMatch(
      /^[A-Za-z0-9+/]{43}=$/,
    );
    expect(
      generateSecret(secret({ encoding: 'base64', bytes: 8 })),
    ).toBeUndefined();
  });

  it('is offered for a secret string only', () => {
    expect(canGenerate(secret())).toBe(true);
    expect(canGenerate(secret({ secret: false }))).toBe(false);
    expect(
      canGenerate({
        type: 'port',
        required: false,
        secret: true,
      } as VariableSpec),
    ).toBe(false);
  });
});
