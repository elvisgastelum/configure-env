// Raw env strings against a variable's spec: validation and coercion.
// Error messages describe the rule, never the value, so a secret cannot leak
// through them.

import { isIP, isIPv4 } from './net.ts';
import { z } from 'zod';
import {
  type Encoding,
  type RuleField,
  type VariableSpec,
  ruleNames,
  ruleValue,
} from './definition.ts';
import {
  contains,
  formatNetwork,
  hasHostBits,
  networkOf,
  parseAddress,
  parseCidr,
} from './ip.ts';

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
// A name whose last label is all digits reads as an IPv4 address (as in the
// WHATWG URL parser), so it is accepted only when it is a valid one.
const NUMERIC_TLD = /(?:^|\.)\d+$/;
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

const HEX = /^(?:[0-9A-Fa-f]{2})+$/;

/**
 * Whether `raw` is canonical in the encoding: it re-encodes to itself, so
 * base64 has its padding and zero pad bits, base64url has no padding, and
 * neither takes the other's alphabet or whitespace. Hex is either case.
 * With `bytes`, it must also decode to that many.
 */
function isEncoded(raw: string, encoding: Encoding, bytes?: number): boolean {
  let decoded: Buffer;
  if (encoding === 'hex') {
    if (!HEX.test(raw)) return false;
    decoded = Buffer.from(raw, 'hex');
  } else {
    decoded = Buffer.from(raw, encoding);
    if (decoded.toString(encoding) !== raw) return false;
  }
  return bytes === undefined || decoded.length === bytes;
}

const withoutColon = (protocol: string) => protocol.replace(/:$/, '');

/** Coerces a non-empty raw value by the spec's type. */
function coerce(spec: VariableSpec, raw: string): ValueResult {
  switch (spec.type) {
    case 'string': {
      if (spec.encoding && !isEncoded(raw, spec.encoding, spec.bytes))
        return invalid(
          spec.bytes === undefined
            ? `must be ${spec.encoding}`
            : `must be ${spec.encoding} that decodes to ${spec.bytes} bytes`,
        );
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
      return isIP(raw) || (HOSTNAME.test(raw) && !NUMERIC_TLD.test(raw))
        ? valid(raw)
        : invalid('must be a hostname or an IP address');
    case 'ipv4':
      return isIPv4(raw) ? valid(raw) : invalid('must be an IPv4 address');
    case 'ipv6':
      return parseAddress(raw)?.family === 6
        ? valid(raw)
        : invalid('must be an IPv6 address');
    case 'ip':
      return parseAddress(raw)
        ? valid(raw)
        : invalid('must be an IPv4 or IPv6 address');
    case 'cidr': {
      const result = parseCidr(raw, spec.family);
      if (!result.ok) return invalid(result.error);
      if (!spec.strict || !hasHostBits(result.network)) return valid(raw);
      // The network address comes from the value: a secret one is not shown.
      return invalid(
        `host bits are set; use ${spec.secret ? 'the network address' : formatNetwork(networkOf(result.network))}`,
      );
    }
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

/** The value as plain text: `true`/`false`, the number, or the string. */
const plainText = (value: VariableValue | null): string =>
  value === null ? '' : String(value);

// Whitespace, comment markers, quote characters and `$` would change how an
// env file reader splits, unquotes or interpolates the value.
const NEEDS_QUOTES = /[\s#"'`$]/;
// Single quotes hold a value literally, but cannot hold a single quote or a
// line break.
const SINGLE_QUOTE_UNSAFE = /['\n\r]/;
const ESCAPES: Record<string, string> = {
  '\\': '\\\\',
  '"': '\\"',
  $: '\\$',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
};
const UNESCAPES: Record<string, string> = {
  '\\': '\\',
  '"': '"',
  $: '$',
  n: '\n',
  r: '\r',
  t: '\t',
};

/**
 * The value as written after `KEY=` in an env file: as is when plain;
 * single-quoted when it holds `$`, so Docker Compose and dotenv-expand do not
 * interpolate it; otherwise, or when single quotes cannot hold it (a single
 * quote or a line break), double-quoted with backslash escapes, `$` written
 * as `\$`. `spec` is taken for type-specific formatting; every type writes
 * its plain text today.
 */
export function formatValue(
  spec: VariableSpec,
  value: VariableValue | null,
): string {
  const text = plainText(value);
  if (!NEEDS_QUOTES.test(text)) return text;
  if (text.includes('$') && !SINGLE_QUOTE_UNSAFE.test(text)) return `'${text}'`;
  return `"${text.replace(/[\\"$\n\r\t]/g, (char) => ESCAPES[char] ?? char)}"`;
}

/**
 * Reads a value written after `KEY=`: undoes {@link formatValue}'s double
 * quotes and escapes, strips single quotes, and keeps anything else as is.
 */
export function unquoteValue(raw: string): string {
  if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'"))
    return raw.slice(1, -1);
  if (raw.length < 2 || !raw.startsWith('"') || !raw.endsWith('"')) return raw;
  return raw
    .slice(1, -1)
    .replace(/\\(.)/gs, (escape, char: string) => UNESCAPES[char] ?? escape);
}

const BULLET = '•';

/**
 * The value for display: a secret longer than 8 characters shows `••••`
 * and its last 2; a shorter one is all bullets. Other values show as is.
 */
export function maskValue(
  spec: VariableSpec,
  value: VariableValue | null,
): string {
  const text = plainText(value);
  if (!spec.secret) return text;
  const chars = [...text];
  if (chars.length > 8) return BULLET.repeat(4) + chars.slice(-2).join('');
  return BULLET.repeat(chars.length);
}

/**
 * Whether `raw`, a value of an address or cidr variable, lies inside the
 * network of `targetRaw`, a cidr value: a block must sit wholly inside it,
 * and a different family never does. Undefined when either value is not set
 * or not valid for its variable, which its own check reports.
 */
export function isWithin(
  spec: VariableSpec,
  raw: string,
  target: VariableSpec,
  targetRaw: string,
): boolean | undefined {
  if (target.type !== 'cidr' || !raw || !targetRaw) return undefined;
  if (!validateValue(spec, raw).ok || !validateValue(target, targetRaw).ok)
    return undefined;
  const outer = parseCidr(targetRaw, target.family);
  if (!outer.ok) return undefined;
  if (spec.type === 'cidr') {
    const inner = parseCidr(raw, spec.family);
    return inner.ok ? contains(outer.network, inner.network) : undefined;
  }
  const address = parseAddress(raw);
  return address ? contains(outer.network, address) : undefined;
}

/**
 * A rule between variables that a file's values break. `others` are the
 * variables the rule names that the file lists; the message names them, never
 * a value.
 */
export interface RuleProblem {
  rule: RuleField;
  /** The variable that declares the rule. */
  key: string;
  others: string[];
  message: string;
}

/** The keys a problem is reported under: both of a conflict, else its own. */
export const ruleKeys = (problem: RuleProblem): string[] =>
  problem.rule === 'conflictsWith'
    ? [problem.key, ...problem.others]
    : [problem.key];

/**
 * The rules between variables that `keys` (one file's variables) break, by
 * `valueOf`, the value a reader of the file sees. A name the file does not
 * list is left out of the rule, and a rule left with no name is skipped. A
 * value counts as set when it is not empty. A pair is reported once.
 */
export function checkRules(
  variables: Readonly<Record<string, VariableSpec>>,
  keys: readonly string[],
  valueOf: (key: string) => string | undefined,
): RuleProblem[] {
  const listed = new Set(keys);
  const isSet = (key: string) => Boolean(valueOf(key));
  const problems: RuleProblem[] = [];
  const reported = new Set<string>();
  const once = (rule: RuleField, a: string, b: string) => {
    const pair = `${rule}:${[a, b].sort().join(',')}`;
    if (reported.has(pair)) return false;
    reported.add(pair);
    return true;
  };
  for (const key of keys) {
    const spec = variables[key];
    if (!spec) continue;
    const named = (field: RuleField) =>
      ruleNames(ruleValue(spec, field)).filter((other) => listed.has(other));

    const alternatives = named('requiredUnless');
    if (alternatives.length && !isSet(key) && !alternatives.some(isSet))
      problems.push({
        rule: 'requiredUnless',
        key,
        others: alternatives,
        message: `required unless ${alternatives.join(' or ')} is set`,
      });
    for (const other of named('conflictsWith')) {
      if (isSet(key) && isSet(other) && once('conflictsWith', key, other))
        problems.push({
          rule: 'conflictsWith',
          key,
          others: [other],
          message: 'set only one of them',
        });
    }
    for (const other of named('distinctFrom')) {
      if (
        isSet(key) &&
        isSet(other) &&
        valueOf(key) === valueOf(other) &&
        once('distinctFrom', key, other)
      )
        problems.push({
          rule: 'distinctFrom',
          key,
          others: [other],
          message: `must differ from ${other}`,
        });
    }
    for (const other of named('within')) {
      const target = variables[other];
      if (!target) continue;
      const inside = isWithin(
        spec,
        valueOf(key) ?? '',
        target,
        valueOf(other) ?? '',
      );
      if (inside === false)
        problems.push({
          rule: 'within',
          key,
          others: [other],
          message: `must be within ${other}`,
        });
    }
  }
  return problems;
}
