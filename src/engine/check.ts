// Checks the env files against the schema without changing them: content
// drift by policy, current values that break their variable's rules, and
// protected values that no longer match the state.

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
  unquoteValue,
  validateValue,
} from '../schema/values.ts';
import {
  type DotenvDocument,
  getValue,
  invalidLineNumbers,
  parseDotenv,
} from './dotenv.ts';
import {
  type FilePlan,
  type PlanError,
  fileKeys,
  formatMode,
  planChanges,
} from './plan.ts';
import {
  type State,
  matchesFingerprint,
  recorded,
  recordedDay,
} from './state.ts';

export type DriftStatus =
  'current' | 'missing' | 'differs' | 'missing-keys' | 'refused';

/**
 * A current value that breaks its rule. The message never holds the value;
 * `shown` is the value for display, masked when the variable is secret.
 */
export interface InvalidValue {
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

export interface FileDrift {
  path: string;
  policy: FilePolicy;
  status: DriftStatus;
  /** Whether a run would change the file: generate and merge files only. */
  drift: boolean;
  /** The keys a merge file lacks. */
  missingKeys: string[];
  invalid: InvalidValue[];
  /** The rules between variables the file's values break. */
  rules: RuleProblem[];
  /** The 1-based numbers of the lines that are not valid entries. */
  invalidLines: number[];
  /** The protected values that no longer match the state. */
  protected: ProtectedMismatch[];
  /** Set when the file's mode differs from the schema's `mode`. */
  mode?: { actual: string; expected: string };
  /** Why the path was refused. */
  error?: string;
}

export interface DriftReport {
  files: FileDrift[];
  /** Whether any file drifted. */
  drift: boolean;
  /** No drift, no invalid value and no error. */
  ok: boolean;
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

function statusOf(plan: FilePlan): Pick<FileDrift, 'status' | 'drift'> {
  if (plan.reason === 'refused') return { status: 'refused', drift: true };
  if (plan.previous === undefined)
    return { status: 'missing', drift: plan.policy !== 'create-only' };
  if (plan.policy === 'generate' && plan.content !== plan.previous)
    return { status: 'differs', drift: true };
  if (plan.policy === 'merge' && plan.addedKeys.length)
    return { status: 'missing-keys', drift: true };
  return { status: 'current', drift: false };
}

/** Drift and invalid values per file, in schema order. Writes nothing. */
export async function checkDrift({
  schema,
  root,
  values = {},
  files,
  state,
}: CheckOptions): Promise<DriftReport> {
  const plan = await planChanges({ schema, root, values, files });
  const report = plan.files.map((filePlan): FileDrift => {
    const spec = schema.files.find((file) => file.path === filePlan.path)!;
    const { status, drift } = statusOf(filePlan);
    const missingKeys = status === 'missing-keys' ? filePlan.addedKeys : [];
    const { previous, currentMode } = filePlan;
    const mode =
      filePlan.modeFixed &&
      currentMode !== undefined &&
      currentMode !== filePlan.mode
        ? {
            actual: formatMode(currentMode),
            expected: formatMode(filePlan.mode),
          }
        : undefined;
    return {
      path: filePlan.path,
      policy: filePlan.policy,
      status,
      drift: drift || Boolean(mode),
      missingKeys,
      invalid:
        previous === undefined
          ? []
          : invalidValues(schema, spec, previous, missingKeys),
      rules:
        previous === undefined
          ? []
          : fileRules(schema, spec, parseDotenv(previous)),
      invalidLines:
        previous === undefined ? [] : invalidLineNumbers(parseDotenv(previous)),
      protected:
        previous === undefined
          ? []
          : protectedMismatches(schema, state, spec, parseDotenv(previous)),
      ...(mode ? { mode } : {}),
      ...(filePlan.error ? { error: filePlan.error } : {}),
    };
  });
  const drift = report.some((file) => file.drift);
  const ok =
    !drift &&
    !plan.errors.length &&
    report.every(
      (file) =>
        !file.invalid.length &&
        !file.rules.length &&
        !file.invalidLines.length &&
        !file.protected.length,
    );
  return { files: report, drift, ok, errors: plan.errors };
}
