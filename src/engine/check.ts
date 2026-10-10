// Checks the env files against the schema without changing them: content
// drift by policy, and current values that break their variable's rules.

import type { EnvSchema, FilePolicy, FileSpec } from '../schema/definition.ts';
import { unquoteValue, validateValue } from '../schema/values.ts';
import { getValue, parseDotenv } from './dotenv.ts';
import {
  type FilePlan,
  type PlanError,
  fileKeys,
  planChanges,
} from './plan.ts';

export type DriftStatus =
  'current' | 'missing' | 'differs' | 'missing-keys' | 'refused';

/** A current value that breaks its rule; the message never holds the value. */
export interface InvalidValue {
  key: string;
  message: string;
}

export interface FileDrift {
  path: string;
  policy: FilePolicy;
  status: DriftStatus;
  /** Whether a run would change the file: generate and merge files only. */
  drift: boolean;
  /** The keys a merge file lacks. */
  missingKeys: string[];
  invalid: InvalidValue[];
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
}

/** Validates each of the file's variables as the file holds it. */
function invalidValues(
  schema: EnvSchema,
  file: FileSpec,
  content: string,
  missingKeys: readonly string[],
): InvalidValue[] {
  const doc = parseDotenv(content);
  const invalid: InvalidValue[] = [];
  for (const key of fileKeys(schema, file)) {
    if (missingKeys.includes(key)) continue;
    const value = getValue(doc, key);
    // A placeholder the file sets on purpose is not type-checked.
    const literal = file.values?.[key];
    if (literal !== undefined && value === unquoteValue(literal)) continue;
    const result = validateValue(schema.variables[key]!, value);
    if (!result.ok) invalid.push({ key, message: result.error });
  }
  return invalid;
}

function statusOf(plan: FilePlan): Pick<FileDrift, 'status' | 'drift'> {
  if (plan.reason === 'refused') return { status: 'refused', drift: true };
  if (plan.previous === undefined)
    return { status: 'missing', drift: plan.policy !== 'create-only' };
  if (plan.policy === 'generate' && plan.action === 'update')
    return { status: 'differs', drift: true };
  if (plan.policy === 'merge' && plan.action === 'update')
    return { status: 'missing-keys', drift: true };
  return { status: 'current', drift: false };
}

/** Drift and invalid values per file, in schema order. Writes nothing. */
export async function checkDrift({
  schema,
  root,
  values = {},
  files,
}: CheckOptions): Promise<DriftReport> {
  const plan = await planChanges({ schema, root, values, files });
  const report = plan.files.map((filePlan): FileDrift => {
    const spec = schema.files.find((file) => file.path === filePlan.path)!;
    const { status, drift } = statusOf(filePlan);
    const missingKeys = status === 'missing-keys' ? filePlan.addedKeys : [];
    return {
      path: filePlan.path,
      policy: filePlan.policy,
      status,
      drift,
      missingKeys,
      invalid:
        filePlan.previous === undefined
          ? []
          : invalidValues(schema, spec, filePlan.previous, missingKeys),
      ...(filePlan.error ? { error: filePlan.error } : {}),
    };
  });
  const drift = report.some((file) => file.drift);
  const ok =
    !drift &&
    !plan.errors.length &&
    report.every((file) => !file.invalid.length);
  return { files: report, drift, ok, errors: plan.errors };
}
