// What a variable's spec says beyond its type: the options its type takes
// and the rules that tie it to other variables.

import type { VariableSpec } from '@configure-env/api-client';

export const RULES = [
  'requiredUnless',
  'conflictsWith',
  'distinctFrom',
  'within',
] as const;
export type Rule = (typeof RULES)[number];

export const OPTIONS = [
  'values',
  'protocols',
  'minLength',
  'maxLength',
  'pattern',
  'patternMessage',
  'encoding',
  'bytes',
  'min',
  'max',
  'family',
  'strict',
  'allowEmpty',
] as const;
export type Option = (typeof OPTIONS)[number];

/** The variables each rule of `spec` names, for the rules it sets. */
export function rulesOf(spec: VariableSpec): { rule: Rule; names: string[] }[] {
  const fields = spec as Partial<Record<Rule, string | string[]>>;
  return RULES.flatMap((rule) => {
    const value = fields[rule];
    if (value === undefined) return [];
    const names = Array.isArray(value) ? value : [value];
    return names.length ? [{ rule, names }] : [];
  });
}

/** The type options `spec` sets, as their values. */
export function optionsOf(
  spec: VariableSpec,
): { option: Option; value: string | number | boolean | string[] }[] {
  const fields = spec as Partial<
    Record<Option, string | number | boolean | string[]>
  >;
  return OPTIONS.flatMap((option) => {
    const value = fields[option];
    return value === undefined ? [] : [{ option, value }];
  });
}
