// Random values for secret strings, so a secret never has to pass through
// a person, a prompt or a request: `configure-env set --generate` and the
// API's value writes. Every outcome is a typed result; nothing is thrown.

import { randomBytes } from 'node:crypto';
import type { VariableSpec } from '../schema/definition.ts';
import { validateValue } from '../schema/values.ts';

/** The length of a generated value, unless minLength or maxLength says otherwise. */
export const GENERATED_LENGTH = 48;

/** The shortest value made: a lower maxLength is refused. */
export const MIN_GENERATED_LENGTH = 16;

/** The bytes made for a string with `encoding` and no `bytes`. */
export const GENERATED_BYTES = 32;

/** The fewest bytes made: a lower `bytes` is refused. */
export const MIN_GENERATED_BYTES = 16;

/** Tries before giving up on a pattern the random values do not match. */
const ATTEMPTS = 10;

export type Generated =
  { ok: true; value: string } | { ok: false; message: string };

/**
 * Why a key cannot be generated, or undefined when it can: only a declared
 * secret string can.
 */
export function generatableProblem(
  spec: VariableSpec | undefined,
  declared: boolean,
): string | undefined {
  if (!declared) return 'is not declared in the schema';
  if (spec?.type !== 'string' || !spec.secret)
    return 'only a secret string variable can be generated';
  return undefined;
}

/**
 * A random value that passes the variable's rules: for a string with
 * `encoding`, `bytes` random bytes (else 32) in it; else characters from the
 * base64url alphabet (`[A-Za-z0-9_-]`, written unquoted).
 */
export function generateValue(spec: VariableSpec): Generated {
  if (spec.type === 'string' && spec.encoding) {
    const { encoding } = spec;
    const bytes = spec.bytes ?? GENERATED_BYTES;
    if (bytes < MIN_GENERATED_BYTES)
      return {
        ok: false,
        message: `bytes ${bytes} is too short for a generated secret`,
      };
    return generateWith(spec, () => randomBytes(bytes).toString(encoding));
  }
  let length = GENERATED_LENGTH;
  if (spec.type === 'string') {
    length = Math.max(length, spec.minLength ?? 0);
    length = Math.min(length, spec.maxLength ?? length);
  }
  // A short secret is a weak one: never make it without notice. Only
  // maxLength lowers the length, so it is the maxLength.
  if (length < MIN_GENERATED_LENGTH)
    return {
      ok: false,
      message: `maxLength ${length} is too short for a generated secret`,
    };
  return generateWith(spec, () =>
    randomBytes(Math.ceil((length * 3) / 4))
      .toString('base64url')
      .slice(0, length),
  );
}

/** The first of a few random values that passes the rules. */
function generateWith(spec: VariableSpec, random: () => string): Generated {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const value = random();
    if (validateValue(spec, value).ok) return { ok: true, value };
  }
  return {
    ok: false,
    message: 'cannot generate a value that passes its rules',
  };
}
