// `--generate KEY` (set, apply): a random value for a secret string, so the
// value never passes through argv, a prompt or whoever runs the command.

import { randomBytes } from 'node:crypto';
import type { VariableSpec } from '../schema/definition.ts';
import { validateValue } from '../schema/values.ts';
import { keyError } from './common.ts';

/** The length of a generated value, unless minLength or maxLength says otherwise. */
export const GENERATED_LENGTH = 48;

/** The shortest value --generate makes: a lower maxLength is refused. */
export const MIN_GENERATED_LENGTH = 16;

/** The bytes --generate makes for a string with `encoding` and no `bytes`. */
export const GENERATED_BYTES = 32;

/** The fewest bytes --generate makes: a lower `bytes` is refused. */
export const MIN_GENERATED_BYTES = 16;

/** Tries before giving up on a pattern the random values do not match. */
const ATTEMPTS = 10;

/** Throws the usage error unless the variable is a secret string. */
export function checkGeneratable(key: string, spec: VariableSpec | undefined) {
  if (spec?.type !== 'string' || !spec.secret)
    throw keyError('usage', key, '--generate takes a secret string variable');
}

/** The keys of the repeated --generate option, each once and checked. */
export function generateKeys(
  keys: readonly string[] = [],
  spec: (key: string) => VariableSpec | undefined,
): string[] {
  const unique = [...new Set(keys)];
  unique.forEach((key) => checkGeneratable(key, spec(key)));
  return unique;
}

/**
 * A random value that passes the variable's rules: for a string with
 * `encoding`, `bytes` random bytes (else 32) in it; else characters from the
 * base64url alphabet (`[A-Za-z0-9_-]`, written unquoted). Exits 1 when none
 * passes.
 */
export function generateValue(key: string, spec: VariableSpec): string {
  if (spec.type === 'string' && spec.encoding) {
    const { encoding } = spec;
    const bytes = spec.bytes ?? GENERATED_BYTES;
    if (bytes < MIN_GENERATED_BYTES)
      throw keyError(
        'usage',
        key,
        `bytes ${bytes} is too short for a generated secret; set it with --prompt or --stdin`,
      );
    return generateWith(key, spec, () => randomBytes(bytes).toString(encoding));
  }
  let length = GENERATED_LENGTH;
  if (spec.type === 'string') {
    length = Math.max(length, spec.minLength ?? 0);
    length = Math.min(length, spec.maxLength ?? length);
  }
  // A short secret is a weak one: never make it without notice. Only
  // maxLength lowers the length, so it is the maxLength.
  if (length < MIN_GENERATED_LENGTH)
    throw keyError(
      'usage',
      key,
      `maxLength ${length} is too short for a generated secret; set it with --prompt or --stdin`,
    );
  return generateWith(key, spec, () =>
    randomBytes(Math.ceil((length * 3) / 4))
      .toString('base64url')
      .slice(0, length),
  );
}

/** The first of a few random values that passes the rules; exits 1 when none does. */
function generateWith(
  key: string,
  spec: VariableSpec,
  random: () => string,
): string {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const value = random();
    if (validateValue(spec, value).ok) return value;
  }
  throw keyError(
    'value',
    key,
    'cannot generate a value that passes its rules; set it with --prompt or --stdin',
  );
}
