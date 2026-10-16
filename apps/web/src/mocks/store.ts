// The sample project as the msw handlers keep it: value and schema writes
// change it, so a refetch after an edit shows the edit, as the real API
// would. Tests reset it after each test; stories before each story.

import type {
  EditProblem,
  Files,
  PlanError,
  Schema,
  VariableSpec,
  Variables,
} from '@configure-env/api-client';
import * as fixtures from './fixtures';

export interface MockState {
  /** env.schema.json, which the schema writes change. */
  schema: Schema;
  /** How many writes changed the schema, for its next fingerprint. */
  schemaWrites: number;
  variables: Variables;
  files: Files;
  /** Plain secret values by `file:key`, as a reveal answers them. */
  secrets: Map<string, string>;
  /** How many writes changed a file, for its next fingerprint. */
  writes: number;
}

const fresh = (): MockState => ({
  schema: structuredClone(fixtures.schema),
  schemaWrites: 0,
  variables: structuredClone(fixtures.variables),
  files: structuredClone(fixtures.files),
  secrets: new Map(),
  writes: 0,
});

export const mockState: MockState = fresh();

/** Back to the sample project, as the fixtures describe it. */
export function resetMockState() {
  Object.assign(mockState, fresh());
}

const MASK = '••••••••';

export const findVariable = (key: string) =>
  mockState.variables.variables.find((variable) => variable.name === key);

export const findFile = (path: string) =>
  mockState.files.files.find((file) => file.path === path);

/** The plain value of `key` in `file`, as a reveal answers it. */
export function plainValue(file: string, key: string): string | null {
  const variable = findVariable(key);
  const entry = variable?.files.find((value) => value.file === file);
  if (!variable || entry?.value === undefined) return null;
  if (!variable.spec.secret) return entry.value;
  return (
    mockState.secrets.get(`${file}:${key}`) ?? fixtures.secretValue(file, key)
  );
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * A stand-in for the core's validateValue: the same rules and messages for
 * the types the sample project uses.
 */
export function problemOf(spec: VariableSpec, raw: string): string | undefined {
  if (raw === '')
    return spec.required
      ? 'is required'
      : spec.allowEmpty
        ? undefined
        : 'must not be empty';
  switch (spec.type) {
    case 'url': {
      let url: URL;
      try {
        url = new URL(raw);
      } catch {
        return 'is not a URL';
      }
      const protocols = spec.protocols ?? ['http', 'https'];
      return protocols.includes(url.protocol.slice(0, -1))
        ? undefined
        : `must use ${protocols.join(' or ')}`;
    }
    case 'email':
      return EMAIL.test(raw) ? undefined : 'is not an email address';
    case 'port': {
      const port = Number(raw);
      return /^\d+$/.test(raw) && port >= 1 && port <= 65535
        ? undefined
        : 'must be a port between 1 and 65535';
    }
    case 'integer':
    case 'number': {
      const value = Number(raw);
      if (raw.trim() === '' || !Number.isFinite(value))
        return 'must be a number';
      if (spec.type === 'integer' && !Number.isInteger(value))
        return 'must be an integer';
      if (spec.min !== undefined && value < spec.min)
        return `must be at least ${spec.min}`;
      if (spec.max !== undefined && value > spec.max)
        return `must be at most ${spec.max}`;
      return undefined;
    }
    case 'boolean':
      return raw === 'true' || raw === 'false'
        ? undefined
        : 'must be true or false';
    case 'enum':
      return spec.values.includes(raw)
        ? undefined
        : `must be one of ${spec.values.join(', ')}`;
    case 'string':
      return spec.minLength !== undefined && raw.length < spec.minLength
        ? `must be at least ${spec.minLength} characters`
        : undefined;
    default:
      return undefined;
  }
}

/** The value and rule problems of setting `values` in `file`. */
export function problemsOf(
  file: string,
  values: Record<string, string>,
): PlanError[] {
  const errors: PlanError[] = [];
  for (const [key, raw] of Object.entries(values)) {
    const variable = findVariable(key);
    if (!variable) {
      errors.push({ kind: 'value', key, message: 'is not declared' });
      continue;
    }
    const problem = problemOf(variable.spec, raw);
    if (problem) errors.push({ kind: 'value', key, message: problem });
    const distinct = variable.spec.distinctFrom;
    for (const other of typeof distinct === 'string'
      ? [distinct]
      : (distinct ?? []))
      if (raw !== '' && plainValue(file, other) === raw)
        errors.push({
          kind: 'value',
          keys: [key, other],
          message: `must differ from ${other}`,
        });
  }
  return errors;
}

/** The problems of a protected key an edit changes without replacing it. */
export function protectedProblems(
  file: string,
  keys: readonly string[],
  replace: readonly string[],
): EditProblem[] {
  return keys.flatMap((key) => {
    const spec = findVariable(key)?.spec;
    if (!spec?.protected || replace.includes(key)) return [];
    if (plainValue(file, key) === null) return [];
    const reason =
      typeof spec.protected === 'object' ? spec.protected.reason : undefined;
    return [{ key, message: 'is protected', ...(reason ? { reason } : {}) }];
  });
}

/** Writes `key` in `file`: a value, or undefined to remove it. */
export function writeValue(file: string, key: string, value?: string) {
  const variable = findVariable(key);
  const entry = variable?.files.find((item) => item.file === file);
  if (!variable || !entry) return;
  const info = findFile(file);
  if (value === undefined) {
    entry.status = 'missing';
    delete entry.value;
    delete entry.error;
  } else {
    entry.status = variable.spec.secret ? 'masked' : 'set';
    entry.value = variable.spec.secret ? MASK : value;
    delete entry.error;
    if (variable.spec.secret) mockState.secrets.set(`${file}:${key}`, value);
    if (info)
      info.drift.missingKeys = info.drift.missingKeys.filter((k) => k !== key);
  }
}

/** A new fingerprint for `file`, after a write changed it. */
export function touchFile(file: string): string | null {
  const info = findFile(file);
  if (!info) return null;
  mockState.writes += 1;
  info.fingerprint = `${file}-${mockState.writes + 1}`;
  info.exists = true;
  return info.fingerprint;
}

/** The schema after a write: its new document and fingerprint. */
export function writeSchema(document: unknown): Schema {
  mockState.schemaWrites += 1;
  mockState.schema = {
    ...mockState.schema,
    valid: true,
    document: structuredClone(document),
    errors: [],
    fingerprint: `schema-${mockState.schemaWrites + 1}`,
  };
  return mockState.schema;
}
