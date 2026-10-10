// Raw env strings against a variable's spec: validation and coercion.
// Error messages describe the rule, never the value, so a secret cannot leak
// through them.

import { isIP, isIPv4 } from 'node:net';
import { z } from 'zod';
import type { VariableSpec } from './definition.ts';

/** A typed variable value: a string, number or boolean by variable type. */
export type VariableValue = string | number | boolean;

/**
 * The typed value, or null for a missing or empty one; or why the raw value
 * is invalid.
 */
export type ValueResult =
  { ok: true; value: VariableValue | null } | { ok: false; error: string };

// An RFC 1123 hostname: dot-separated labels of letters, digits and inner
// hyphens, each at most 63 characters.
const HOSTNAME =
  /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const INTEGER = /^[+-]?\d+$/;
const BOOLEANS: Record<string, boolean> = {
  true: true,
  false: false,
  '1': true,
  '0': false,
  yes: true,
  no: false,
  on: true,
  off: false,
};
const email = z.email();

/** Whether an empty value is accepted: `allowEmpty`, else when not required. */
export const allowsEmpty = (spec: VariableSpec): boolean =>
  spec.allowEmpty ?? !spec.required;

const valid = (value: VariableValue | null): ValueResult => ({
  ok: true,
  value,
});
const invalid = (error: string): ValueResult => ({ ok: false, error });

function checkRange(
  value: number,
  min: number | undefined,
  max: number | undefined,
): ValueResult {
  if (min !== undefined && value < min)
    return invalid(`must be at least ${min}`);
  if (max !== undefined && value > max)
    return invalid(`must be at most ${max}`);
  return valid(value);
}

const withoutColon = (protocol: string) => protocol.replace(/:$/, '');

/** Coerces a non-empty raw value by the spec's type. */
function coerce(spec: VariableSpec, raw: string): ValueResult {
  switch (spec.type) {
    case 'string': {
      const length = [...raw].length;
      if (spec.minLength !== undefined && length < spec.minLength)
        return invalid(`must be at least ${spec.minLength} characters`);
      if (spec.maxLength !== undefined && length > spec.maxLength)
        return invalid(`must be at most ${spec.maxLength} characters`);
      if (
        spec.pattern !== undefined &&
        !new RegExp(spec.pattern, 'u').test(raw)
      )
        return invalid(
          spec.patternMessage ?? `must match the pattern ${spec.pattern}`,
        );
      return valid(raw);
    }
    case 'number': {
      const value = Number(raw);
      if (!DECIMAL.test(raw) || !Number.isFinite(value))
        return invalid('must be a number');
      return checkRange(value, spec.min, spec.max);
    }
    case 'integer': {
      const value = Number(raw);
      if (!INTEGER.test(raw) || !Number.isSafeInteger(value))
        return invalid('must be a whole number');
      return checkRange(value, spec.min, spec.max);
    }
    case 'boolean': {
      const value = BOOLEANS[raw.toLowerCase()];
      return value === undefined
        ? invalid('must be true or false')
        : valid(value);
    }
    case 'enum':
      return spec.values.includes(raw)
        ? valid(raw)
        : invalid(`must be one of ${spec.values.join(', ')}`);
    case 'email':
      return email.safeParse(raw).success
        ? valid(raw)
        : invalid('must be an email address');
    case 'url': {
      if (!URL.canParse(raw)) return invalid('must be an absolute URL');
      const protocols = spec.protocols?.map(withoutColon);
      const protocol = withoutColon(new URL(raw).protocol);
      if (protocols && !protocols.includes(protocol))
        return invalid(`must be a URL using ${protocols.join(', ')}`);
      return valid(raw);
    }
    case 'host':
      return HOSTNAME.test(raw) || isIP(raw)
        ? valid(raw)
        : invalid('must be a hostname or an IP address');
    case 'ipv4':
      return isIPv4(raw) ? valid(raw) : invalid('must be an IPv4 address');
    case 'port': {
      const value = Number(raw);
      return /^\d+$/.test(raw) && value >= 1 && value <= 65535
        ? valid(value)
        : invalid('must be a port between 1 and 65535');
    }
  }
}

/**
 * Validates a raw env value (undefined when the variable is not set) and
 * coerces it to the variable's type.
 */
export function validateValue(
  spec: VariableSpec,
  raw: string | undefined,
): ValueResult {
  if (raw === undefined)
    return spec.required ? invalid('is required') : valid(null);
  if (raw === '') {
    if (allowsEmpty(spec)) return valid(null);
    return invalid(spec.required ? 'is required' : 'must not be empty');
  }
  return coerce(spec, raw);
}
