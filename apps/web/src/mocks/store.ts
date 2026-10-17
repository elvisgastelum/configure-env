// The sample project as the msw handlers keep it: value and schema writes
// change it, so a refetch after an edit shows the edit, as the real API
// would. Tests reset it after each test; stories before each story.

import type {
  Applied,
  Change,
  Check,
  EditProblem,
  FileCheck,
  FileInfo,
  FilePlan,
  Files,
  Group,
  Groups,
  Plan,
  PlanError,
  PlanRequest,
  Problem,
  Schema,
  Variable,
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
  /** Each existing file's lines, secrets masked, by path. */
  lines: Map<string, string[]>;
  /** Plain secret values by `file:key`, as a reveal answers them. */
  secrets: Map<string, string>;
  /** How many writes changed a file, for its next fingerprint. */
  writes: number;
  /** The history of edits, newest first. */
  history: Change[];
}

const fresh = (): MockState => ({
  schema: structuredClone(fixtures.schema),
  schemaWrites: 0,
  variables: structuredClone(fixtures.variables),
  files: structuredClone(fixtures.files),
  lines: new Map(Object.entries(structuredClone(fixtures.fileLines))),
  secrets: new Map(),
  writes: 0,
  history: structuredClone(fixtures.history),
});

export const mockState: MockState = fresh();

/** A portal listening on GET /api/events. */
export interface EventClient {
  send(
    payload:
      | { event: 'changed'; data: { paths: string[] } }
      | { retry: number },
  ): void;
  close(): void;
}

/** The portals listening now; a reset forgets them. */
export const eventClients = new Set<EventClient>();

/**
 * Tells every listening portal that `paths` changed outside it, as the API
 * does when a file it watches changes on disk.
 */
export function emitChanged(paths: string[]) {
  for (const client of eventClients)
    try {
      client.send({ event: 'changed', data: { paths } });
    } catch {
      // The portal closed its stream.
      eventClients.delete(client);
    }
}

/**
 * Ends every portal's event stream, as a restarted API or a dropped network
 * does. Each portal reconnects at once (a short `retry`), as a browser does.
 */
export function dropEvents() {
  for (const client of eventClients)
    try {
      client.send({ retry: 1 });
      client.close();
    } catch {
      // The portal closed its stream already.
    }
  eventClients.clear();
}

/** Back to the sample project, as the fixtures describe it. */
export function resetMockState() {
  Object.assign(mockState, fresh());
  eventClients.clear();
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
  writeLine(file, key, value === undefined ? undefined : entry.value);
}

/** The line of `key` in `file`'s lines: replaced, added, or removed. */
export function writeLine(file: string, key: string, shown?: string) {
  const lines = mockState.lines.get(file) ?? [];
  const at = lines.findIndex((line) => line.startsWith(`${key}=`));
  if (shown === undefined) {
    if (at !== -1) lines.splice(at, 1);
  } else if (at === -1) lines.push(`${key}=${shown}`);
  else lines[at] = `${key}=${shown}`;
  mockState.lines.set(file, lines);
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

/**
 * The variables by group heading as GET /api/groups answers it, from the
 * schema document: in schema order, the ungrouped ones last. It copies
 * `listGroups` in apps/api/src/inspect.ts; change both together.
 */
export function groupsOf(): Groups {
  const groups = new Map<string | null, Group>();
  const { variables } = mockState.schema.document as {
    variables: Record<string, VariableSpec>;
  };
  for (const [name, spec] of Object.entries(variables)) {
    const heading = spec.group ?? null;
    const group = groups.get(heading) ?? {
      name: heading,
      variables: [],
      required: 0,
      secret: 0,
      protected: 0,
    };
    groups.set(heading, group);
    group.variables.push(name);
    if (spec.required) group.required += 1;
    if (spec.secret) group.secret += 1;
    if (spec.protected !== undefined) group.protected += 1;
  }
  const ungrouped = groups.get(null);
  groups.delete(null);
  return { groups: [...groups.values(), ...(ungrouped ? [ungrouped] : [])] };
}

/** A short hash of `text`, so a plan fingerprint names no value. */
function hash(text: string): string {
  let value = 5381;
  for (const char of text)
    value = ((value << 5) + value + char.charCodeAt(0)) | 0;
  return (value >>> 0).toString(16);
}

/** The variables `path` lists, in schema order. */
const variablesIn = (path: string) =>
  mockState.variables.variables.filter((variable) =>
    variable.files.some((entry) => entry.file === path),
  );

/** The value a run writes for `variable`: given, else its default. */
const valueFor = (variable: Variable, values: Record<string, string>) =>
  values[variable.name] ??
  (variable.spec.default === undefined ? '' : String(variable.spec.default));

const shownLine = (variable: Variable, value: string) =>
  `${variable.name}=${variable.spec.secret && value !== '' ? MASK : value}`;

/**
 * What applying would do, as POST /api/plan answers it for the sample
 * project: a template is left as it is, a missing file is created with its
 * variables, a merge file gains its missing keys and its schema mode, and
 * with `prune` loses the keys the schema does not declare.
 */
export function planOf(inputs: PlanRequest): Plan {
  const values = inputs.values ?? {};
  const errors: PlanError[] = [];
  const seen = new Set<string>();
  const addError = (error: PlanError) => {
    const id = JSON.stringify(error);
    if (seen.has(id)) return;
    seen.add(id);
    errors.push(error);
  };
  const infos = mockState.files.files.filter(
    (info) => !inputs.files || inputs.files.includes(info.path),
  );
  const files = infos.map((info): FilePlan => {
    const lines = mockState.lines.get(info.path) ?? [];
    const base = {
      path: info.path,
      policy: info.policy,
      addedKeys: [] as string[],
      prunedKeys: [] as string[],
      mode: info.mode.expected ?? info.mode.actual ?? '644',
      currentMode: info.mode.actual,
      fingerprint: info.fingerprint ?? null,
    };
    for (const error of problemsOf(info.path, values)) addError(error);
    if (info.template)
      return {
        ...base,
        action: 'unchanged',
        diff: lines.map((line) => ({ kind: 'same', line })),
      };
    if (info.exists && info.policy === 'create-only')
      return { ...base, action: 'skip', reason: 'exists', diff: [] };
    const added = info.exists
      ? info.drift.missingKeys.flatMap((key) => findVariable(key) ?? [])
      : variablesIn(info.path);
    const pruned =
      inputs.prune && info.exists ? [...info.drift.unknownKeys] : [];
    for (const variable of added)
      if (variable.spec.required && valueFor(variable, values) === '')
        addError({ kind: 'value', key: variable.name, message: 'is required' });
    const diff = [
      ...lines.map((line) => ({
        kind: pruned.some((key) => line.startsWith(`${key}=`))
          ? ('removed' as const)
          : ('same' as const),
        line,
      })),
      ...added.map((variable) => ({
        kind: 'added' as const,
        line: shownLine(variable, valueFor(variable, values)),
      })),
    ];
    const action = !info.exists
      ? 'create'
      : added.length || pruned.length
        ? 'update'
        : base.mode !== base.currentMode
          ? 'mode'
          : 'unchanged';
    return {
      ...base,
      action,
      addedKeys: added.map((variable) => variable.name),
      prunedKeys: pruned,
      diff,
    };
  });
  return {
    fingerprint: `plan-${hash(
      JSON.stringify([
        mockState.writes,
        values,
        inputs.files ?? null,
        inputs.prune ?? false,
        files.map((file) => file.action),
      ]),
    )}`,
    ok: errors.length === 0,
    files,
    errors,
    protected: [],
  };
}

const WRITES = new Set<FilePlan['action']>(['create', 'update', 'mode']);

/** Writes the plan of `inputs`, as POST /api/apply does once it matches. */
export function applyPlan(inputs: PlanRequest): Applied {
  const values = inputs.values ?? {};
  const plan = planOf(inputs);
  for (const file of plan.files) {
    if (!WRITES.has(file.action)) continue;
    const info = findFile(file.path)!;
    if (file.action === 'create') mockState.lines.set(file.path, []);
    for (const key of file.addedKeys) {
      const value = valueFor(findVariable(key)!, values);
      if (value === '') writeLine(file.path, key, '');
      else writeValue(file.path, key, value);
    }
    for (const key of file.prunedKeys) writeLine(file.path, key);
    info.exists = true;
    info.mode.actual = file.mode;
    info.drift = {
      ...info.drift,
      status: 'current',
      drift: false,
      missingKeys: [],
      unknownKeys: info.drift.unknownKeys.filter(
        (key) => !file.prunedKeys.includes(key),
      ),
    };
    touchFile(file.path);
  }
  return {
    ok: true,
    files: plan.files.map((file) => ({
      path: file.path,
      action: file.action,
      ok: true,
      written: WRITES.has(file.action),
    })),
    replaced: [],
    warnings: [],
  };
}

/**
 * The value problems each existing file holds now, masked as the API shows
 * them: invalid values, and required values the file lacks that are not
 * already missing keys. A template holds placeholders, so it has none.
 */
const valueProblemsIn = (path: string, missingKeys: readonly string[]) =>
  variablesIn(path).flatMap((variable): Problem[] => {
    const entry = variable.files.find((value) => value.file === path)!;
    const base = {
      severity: 'error' as const,
      code: 'invalid-value' as const,
      key: variable.name,
      fix: 'set' as const,
    };
    if (entry.status === 'invalid')
      return [
        {
          ...base,
          message: entry.error ?? 'is invalid',
          shown: entry.value ?? '',
        },
      ];
    if (
      entry.status === 'missing' &&
      variable.spec.required &&
      !missingKeys.includes(variable.name)
    )
      return [{ ...base, message: 'is required', shown: '' }];
    return [];
  });

/** One file's problems in the core's order, as GET /api/check lists them. */
function problemsIn(info: FileInfo): Problem[] {
  const error = 'error' as const;
  const { status, missingKeys, unknownKeys } = info.drift;
  if (status === 'missing')
    return [
      {
        severity: error,
        code: 'missing-file',
        message: 'missing',
        fix: 'apply',
      },
    ];
  const problems: Problem[] = [];
  if (status === 'differs')
    problems.push({
      severity: error,
      code: 'differs',
      message: 'differs from the schema',
      fix: 'apply',
    });
  const { expected, actual } = info.mode;
  if (expected && actual && expected !== actual)
    problems.push({
      severity: error,
      code: 'mode',
      message: `mode ${actual}, expected ${expected}`,
      fix: 'apply',
    });
  for (const key of missingKeys)
    problems.push({
      severity: error,
      code: 'missing-key',
      key,
      message: 'is missing',
      fix: 'apply',
    });
  for (const { line } of info.parseErrors)
    problems.push({
      severity: error,
      code: 'invalid-line',
      line,
      message: 'is not a valid entry',
    });
  if (!info.template) problems.push(...valueProblemsIn(info.path, missingKeys));
  for (const key of unknownKeys)
    problems.push({
      severity: 'warning',
      code: 'unknown-key',
      key,
      message: 'is not in the schema for this file',
      fix: 'prune',
    });
  return problems;
}

/**
 * The report as GET /api/check answers it for the sample project as it is
 * now, so a fix shows in the next report.
 */
export function checkOf(): Check {
  const files = mockState.files.files.map((info): FileCheck => {
    const { expected, actual } = info.mode;
    const problems = problemsIn(info);
    return {
      path: info.path,
      policy: info.policy,
      template: info.template,
      status: info.drift.status,
      ...(info.exists && expected && actual && expected !== actual
        ? { mode: { actual, expected } }
        : {}),
      ok: problems.every((problem) => problem.severity !== 'error'),
      problems,
    };
  });
  const count = (severity: Problem['severity']) =>
    files.reduce(
      (sum, file) =>
        sum + file.problems.filter((p) => p.severity === severity).length,
      0,
    );
  const failing = files.filter((file) => !file.ok).length;
  return {
    command: 'check',
    ok: failing === 0,
    summary: {
      errors: count('error'),
      warnings: count('warning'),
      files: files.length,
      failing,
    },
    files,
    errors: [],
  };
}

// ---------------------------------------------------------------- history

/** Records a change as the API does, newest first; its id. */
function recordChange(change: Omit<Change, 'id' | 'at'>): number {
  const id = Math.max(0, ...mockState.history.map((entry) => entry.id)) + 1;
  mockState.history.unshift({ ...change, id, at: new Date().toISOString() });
  return id;
}

const MASKED_PREVIEW = '••••';

/**
 * Records a value write of `key` in `file`: the value before and after
 * (undefined when unset), never a secret's.
 */
export function recordValueChange(
  file: string,
  key: string,
  before: string | null,
  after: string | null,
  {
    replaced = false,
    undoOf = null,
  }: { replaced?: boolean; undoOf?: number | null } = {},
): number | undefined {
  if (before === after) return undefined;
  const secret = findVariable(key)?.spec.secret ?? false;
  const preview = (value: string | null) =>
    value === null ? null : secret ? MASKED_PREVIEW : value;
  return recordChange({
    actor: 'portal',
    file,
    key,
    operation: replaced ? 'replace' : after === null ? 'unset' : 'set',
    secret,
    beforePreview: preview(before),
    afterPreview: preview(after),
    beforeValue: secret ? null : before,
    afterValue: secret ? null : after,
    restorable: !secret,
    ...(secret ? { undoBlocker: fixtures.SECRET_UNDO_REASON } : {}),
    undoOf,
  });
}

/** How the history previews a schema: its variable and file counts. */
function schemaPreview(text: string): string {
  const document = JSON.parse(text) as {
    variables?: Record<string, unknown>;
    files?: unknown[];
  };
  const count = (n: number, word: string) =>
    `${n} ${word}${n === 1 ? '' : 's'}`;
  return `${count(Object.keys(document.variables ?? {}).length, 'variable')}, ${count(document.files?.length ?? 0, 'file')}`;
}

/** Records a schema write with its text before and after. */
export function recordSchemaChange(
  before: string,
  after: string,
  undoOf: number | null = null,
): number | undefined {
  if (before === after) return undefined;
  return recordChange({
    actor: 'portal',
    file: mockState.schema.path,
    key: '',
    operation: 'schema',
    secret: false,
    beforePreview: schemaPreview(before),
    afterPreview: schemaPreview(after),
    beforeValue: before,
    afterValue: after,
    restorable: true,
    undoOf,
  });
}

export interface HistoryFilter {
  file?: string | null;
  key?: string | null;
  actor?: string | null;
  from?: string | null;
  to?: string | null;
  page?: number;
  limit?: number;
}

/** A page of the history, as GET /api/history answers it. */
export function queryHistory(filter: HistoryFilter) {
  const page = filter.page ?? 1;
  const limit = filter.limit ?? 50;
  const bound = (value: string, end: boolean) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? `${value}T${end ? '23:59:59.999' : '00:00:00.000'}Z`
      : new Date(value).toISOString();
  const matching = mockState.history.filter(
    (change) =>
      (filter.file == null || change.file === filter.file) &&
      (filter.key == null || change.key === filter.key) &&
      (filter.actor == null || change.actor === filter.actor) &&
      (filter.from == null || change.at >= bound(filter.from, false)) &&
      (filter.to == null || change.at <= bound(filter.to, true)),
  );
  return {
    changes: matching.slice((page - 1) * limit, page * limit),
    total: matching.length,
    page,
    limit,
  };
}

/** An undo as POST /api/history/{id}/undo answers it: a status and a body. */
export function undoMockChange(id: number): { status: number; body: object } {
  const change = mockState.history.find((entry) => entry.id === id);
  if (!change)
    return {
      status: 404,
      body: { statusCode: 404, message: `no change ${id} in the history` },
    };
  if (!change.restorable) {
    const message = change.undoBlocker ?? "this change can't be undone";
    return {
      status: 422,
      body: {
        statusCode: 422,
        message,
        kind: 'not-restorable',
        errors: [{ message }],
        change,
      },
    };
  }
  if (change.operation === 'schema') {
    const current = fixtures.schemaText(mockState.schema.document);
    if (current !== change.afterValue)
      return {
        status: 409,
        body: {
          statusCode: 409,
          message: `${change.file} changed after this change was made, so it was not undone`,
          change,
          schema: mockState.schema,
        },
      };
    const schema = writeSchema(JSON.parse(change.beforeValue!));
    const newId = recordSchemaChange(current, change.beforeValue!, id);
    return {
      status: 200,
      body: {
        undone: change,
        change: mockState.history.find((entry) => entry.id === newId),
        schema,
        warnings: [],
      },
    };
  }
  const current = plainValue(change.file, change.key);
  if (current !== change.afterValue)
    return {
      status: 409,
      body: {
        statusCode: 409,
        message:
          current === null
            ? `${change.key} is no longer set in ${change.file}, so this change was not undone; it changed after this change was made`
            : `${change.key} in ${change.file} no longer holds the value this change wrote, so it was not undone; it changed after this change was made`,
        change,
        file: findFile(change.file),
      },
    };
  writeValue(change.file, change.key, change.beforeValue ?? undefined);
  touchFile(change.file);
  const newId = recordValueChange(
    change.file,
    change.key,
    current,
    change.beforeValue,
    { undoOf: id },
  );
  return {
    status: 200,
    body: {
      undone: change,
      change: mockState.history.find((entry) => entry.id === newId),
      file: findFile(change.file),
      warnings: [],
    },
  };
}

/**
 * Where open-in-editor opens: the position asked, else the last line that
 * sets the key (the variable's definition, in the schema, at the top).
 */
export function editorPosition(body: {
  file: string;
  line?: number;
  column?: number;
  key?: string;
}): { line: number; column: number } {
  if (body.line !== undefined)
    return { line: body.line, column: body.column ?? 1 };
  const lines = mockState.lines.get(body.file) ?? [];
  const key = body.key;
  const index = key
    ? lines.findLastIndex((text) =>
        new RegExp(`^\\s*(export\\s+)?${key}\\s*=`).test(text),
      )
    : -1;
  return { line: index + 1 || 1, column: 1 };
}
