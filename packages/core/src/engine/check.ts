// Checks the env files against the schema without changing them, as one
// report of problems per file: content drift by policy, lines that do not
// parse, current values that break their variable's rules, protected values
// that no longer match the state, and keys the schema does not list.

import {
  type EnvSchema,
  type FilePolicy,
  type FileSpec,
  isTemplate,
  protectedReason,
} from '../schema/definition.ts';
import {
  type RuleProblem,
  checkRules,
  maskValue,
  ruleKeys,
  unquoteValue,
  validateValue,
} from '../schema/values.ts';
import {
  type DotenvDocument,
  getValue,
  invalidLineNumbers,
  keysOf,
  parseDotenv,
} from './dotenv.ts';
import {
  type FilePlan,
  type PlanError,
  fileKeys,
  formatMode,
  planChanges,
  unknownKeys,
} from './plan.ts';
import {
  type State,
  matchesFingerprint,
  recorded,
  recordedDay,
} from './state.ts';

export type DriftStatus =
  | 'current'
  | 'missing'
  | 'differs'
  | 'missing-keys'
  | 'refused';

export type ProblemSeverity = 'error' | 'warning';

export const PROBLEM_CODES = [
  'missing-file',
  'differs',
  'missing-key',
  'mode',
  'refused',
  'invalid-line',
  'invalid-value',
  'rule',
  'protected',
  'unknown-key',
] as const;

export type ProblemCode = (typeof PROBLEM_CODES)[number];

/** What fixes a problem: `configure-env apply`, `apply --prune`, or a value to set. */
export type ProblemFix = 'apply' | 'prune' | 'set';

/**
 * One finding in a file. `message` never holds a value; `shown` is the
 * value of an invalid one for display, masked when the variable is secret.
 * A rule over several keys lists them in `keys`; a protected value gives
 * the schema's `reason` when it has one. No `fix` means a person decides.
 */
export interface CheckProblem {
  severity: ProblemSeverity;
  code: ProblemCode;
  key?: string;
  keys?: string[];
  line?: number;
  message: string;
  shown?: string;
  reason?: string;
  fix?: ProblemFix;
}

/**
 * A current value that breaks its rule. The message never holds the value;
 * `shown` is the value for display, masked when the variable is secret.
 */
interface InvalidValue {
  key: string;
  message: string;
  shown: string;
}

/**
 * A protected value that no longer matches the one the state recorded for
 * it. Never holds a value; `reason` is the schema's, when it gives one.
 */
export interface ProtectedMismatch {
  kind: 'protected';
  key: string;
  message: string;
  reason?: string;
}

export { formatMode } from './plan.ts';

export interface FileCheck {
  path: string;
  policy: FilePolicy;
  template: boolean;
  status: DriftStatus;
  /** Set when the file's mode differs from the schema's `mode`. */
  mode?: { actual: string; expected: string };
  /** No error-severity problem. */
  ok: boolean;
  problems: CheckProblem[];
}

export interface CheckReport {
  command: 'check';
  /** No error-severity problem and no plan error. */
  ok: boolean;
  summary: {
    errors: number;
    warnings: number;
    /** The files checked. */
    files: number;
    /** The files with an error. */
    failing: number;
  };
  files: FileCheck[];
  errors: PlanError[];
}

export interface CheckOptions {
  schema: EnvSchema;
  root: string;
  /** Values a generated file is compared with; defaults otherwise. */
  values?: Readonly<Record<string, string>>;
  files?: readonly string[];
  /** The protected variables' state; no mismatch is reported without it. */
  state?: State;
  /** Reports the keys the schema does not list as errors, not warnings. */
  strict?: boolean;
}

/** Validates each of the file's variables as the file holds it. */
function invalidValues(
  schema: EnvSchema,
  file: FileSpec,
  content: string,
  missingKeys: readonly string[],
): InvalidValue[] {
  // A template holds placeholders, not values to check.
  if (isTemplate(file)) return [];
  const doc = parseDotenv(content);
  const invalid: InvalidValue[] = [];
  for (const key of fileKeys(schema, file)) {
    if (missingKeys.includes(key)) continue;
    const value = getValue(doc, key);
    // A placeholder the file sets on purpose is not type-checked.
    const literal = file.values?.[key];
    if (literal !== undefined && value === unquoteValue(literal)) continue;
    const spec = schema.variables[key]!;
    const result = validateValue(spec, value);
    if (!result.ok)
      invalid.push({
        key,
        message: result.error,
        shown: maskValue(spec, value ?? ''),
      });
  }
  return invalid;
}

/**
 * The rules between variables the file's values break, over the file's own
 * keys. A template holds placeholders, so it breaks none.
 */
export function fileRules(
  schema: EnvSchema,
  file: FileSpec,
  doc: DotenvDocument,
): RuleProblem[] {
  if (isTemplate(file)) return [];
  return checkRules(schema.variables, fileKeys(schema, file), (key) =>
    getValue(doc, key),
  );
}

/**
 * The protected values the file holds that differ from the ones the state
 * recorded for them. An empty or missing value, or one never recorded, is
 * not a mismatch; a template holds placeholders, so it has none.
 */
export function protectedMismatches(
  schema: EnvSchema,
  state: State | undefined,
  file: FileSpec,
  doc: DotenvDocument,
): ProtectedMismatch[] {
  if (!state || isTemplate(file)) return [];
  const mismatches: ProtectedMismatch[] = [];
  for (const key of fileKeys(schema, file)) {
    const spec = schema.variables[key]!;
    if (spec.protected === undefined) continue;
    const value = getValue(doc, key);
    const entry = recorded(state, file.path, key);
    if (!value || !entry || matchesFingerprint(state, file.path, key, value))
      continue;
    const reason = protectedReason(spec);
    mismatches.push({
      kind: 'protected',
      key,
      message: `no longer matches the value recorded on ${recordedDay(entry.recordedAt)}`,
      ...(reason ? { reason } : {}),
    });
  }
  return mismatches;
}

function statusOf(plan: FilePlan): DriftStatus {
  if (plan.reason === 'refused') return 'refused';
  if (plan.previous === undefined) return 'missing';
  if (plan.policy === 'generate' && plan.content !== plan.previous)
    return 'differs';
  if (plan.policy === 'merge' && plan.addedKeys.length) return 'missing-keys';
  return 'current';
}

const UNKNOWN_MESSAGE = 'is not in the schema for this file';

/**
 * The file's problems in a fixed order: its state, its mode, the keys it
 * lacks, its lines, values, rules and protected values, then unknown keys.
 */
function fileProblems(
  schema: EnvSchema,
  spec: FileSpec,
  plan: FilePlan,
  status: DriftStatus,
  mode: FileCheck['mode'],
  strict: boolean,
  state: State | undefined,
): CheckProblem[] {
  const error = 'error' as const;
  if (status === 'refused')
    return [
      { severity: error, code: 'refused', message: `refused: ${plan.error}` },
    ];
  if (status === 'missing')
    return [
      {
        severity: error,
        code: 'missing-file',
        message: 'missing',
        fix: 'apply',
      },
    ];
  const doc = parseDotenv(plan.previous!);
  const problems: CheckProblem[] = [];
  if (status === 'differs')
    problems.push({
      severity: error,
      code: 'differs',
      message: 'differs from the schema',
      fix: 'apply',
    });
  if (mode)
    problems.push({
      severity: error,
      code: 'mode',
      message: `mode ${mode.actual}, expected ${mode.expected}`,
      // apply never adds a permission: a person chmods the file.
      ...(plan.reason === 'loosens' ? {} : { fix: 'apply' as const }),
    });
  // A template holds placeholders: only whether each key is there counts.
  const present = new Set(keysOf(doc));
  const missingKeys = isTemplate(spec)
    ? fileKeys(schema, spec).filter((key) => !present.has(key))
    : status === 'missing-keys'
      ? plan.addedKeys
      : [];
  for (const key of missingKeys)
    problems.push({
      severity: error,
      code: 'missing-key',
      key,
      message: 'is missing',
      fix: 'apply',
    });
  for (const line of invalidLineNumbers(doc))
    problems.push({
      severity: error,
      code: 'invalid-line',
      line,
      message: 'is not a valid entry',
    });
  for (const { key, message, shown } of invalidValues(
    schema,
    spec,
    plan.previous!,
    missingKeys,
  ))
    problems.push({
      severity: error,
      code: 'invalid-value',
      key,
      message,
      shown,
      fix: 'set',
    });
  for (const problem of fileRules(schema, spec, doc)) {
    const keys = ruleKeys(problem);
    problems.push({
      severity: error,
      code: 'rule',
      key: problem.key,
      ...(keys.length > 1 ? { keys } : {}),
      message: problem.message,
      fix: 'set',
    });
  }
  for (const { key, message, reason } of protectedMismatches(
    schema,
    state,
    spec,
    doc,
  ))
    problems.push({
      severity: error,
      code: 'protected',
      key,
      message,
      ...(reason ? { reason } : {}),
    });
  for (const key of unknownKeys(schema, spec, doc))
    problems.push({
      severity: strict ? error : 'warning',
      code: 'unknown-key',
      key,
      message: UNKNOWN_MESSAGE,
      fix: 'prune',
    });
  return problems;
}

/**
 * Checks the env files against the schema: one report, by file in schema
 * order, of every problem with its severity, code and fix. Writes nothing.
 */
export async function checkDrift({
  schema,
  root,
  values = {},
  files,
  state,
  strict = false,
}: CheckOptions): Promise<CheckReport> {
  const plan = await planChanges({ schema, root, values, files });
  const report = plan.files.map((filePlan): FileCheck => {
    const spec = schema.files.find((file) => file.path === filePlan.path)!;
    const status = statusOf(filePlan);
    const { currentMode } = filePlan;
    const mode =
      filePlan.modeFixed &&
      currentMode !== undefined &&
      currentMode !== filePlan.mode
        ? {
            actual: formatMode(currentMode),
            expected: formatMode(filePlan.mode),
          }
        : undefined;
    const problems = fileProblems(
      schema,
      spec,
      filePlan,
      status,
      mode,
      strict,
      state,
    );
    return {
      path: filePlan.path,
      policy: filePlan.policy,
      template: isTemplate(spec),
      status,
      ...(mode ? { mode } : {}),
      ok: problems.every((problem) => problem.severity !== 'error'),
      problems,
    };
  });
  const all = report.flatMap((file) => file.problems);
  const errors = all.filter((problem) => problem.severity === 'error').length;
  return {
    command: 'check',
    ok: !errors && !plan.errors.length,
    summary: {
      errors,
      warnings: all.length - errors,
      files: report.length,
      failing: report.filter((file) => !file.ok).length,
    },
    files: report,
    errors: plan.errors,
  };
}
