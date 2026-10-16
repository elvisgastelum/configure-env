// A random value for a secret string, made in the browser for the apply
// flow's prompts (plan and apply take values, not keys to generate). It
// follows the core's generator (packages/core/src/edit/generate.ts): bytes
// in the variable's encoding, else base64url characters, retried until the
// value passes the variable's rules.

import type { VariableSpec } from '@configure-env/api-client';
import { validateValue } from '@configure-env/core/schema';
import type { VariableSpec as CoreSpec } from '@configure-env/core/schema';

const GENERATED_LENGTH = 48;
const MIN_GENERATED_LENGTH = 16;
const GENERATED_BYTES = 32;
const MIN_GENERATED_BYTES = 16;
const ATTEMPTS = 10;

const randomBytes = (count: number) =>
  crypto.getRandomValues(new Uint8Array(count));

const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const base64url = (bytes: Uint8Array) =>
  base64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const hex = (bytes: Uint8Array) =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');

const ENCODE = { base64, base64url, hex };

/** Whether the prompt offers Generate: a secret string only. */
export const canGenerate = (spec: VariableSpec) =>
  spec.type === 'string' && spec.secret;

/** A random value that passes the variable's rules, or undefined. */
export function generateSecret(spec: VariableSpec): string | undefined {
  if (spec.type !== 'string') return undefined;
  let random: () => string;
  if (spec.encoding) {
    const bytes = spec.bytes ?? GENERATED_BYTES;
    if (bytes < MIN_GENERATED_BYTES) return undefined;
    const encode = ENCODE[spec.encoding];
    random = () => encode(randomBytes(bytes));
  } else {
    let length = Math.max(GENERATED_LENGTH, spec.minLength ?? 0);
    length = Math.min(length, spec.maxLength ?? length);
    if (length < MIN_GENERATED_LENGTH) return undefined;
    random = () =>
      base64url(randomBytes(Math.ceil((length * 3) / 4))).slice(0, length);
  }
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const value = random();
    if (validateValue(spec as CoreSpec, value).ok) return value;
  }
  return undefined;
}
