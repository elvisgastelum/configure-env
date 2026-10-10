// `configure-env list` and `validate`: read-only views of the values the
// env files hold now, checked against the schema.

import {
  type DotenvDocument,
  getValue,
  invalidLineNumbers,
  keysOf,
} from '../engine/dotenv.ts';
import { fileRules } from '../engine/check.ts';
import { fileKeys } from '../engine/plan.ts';
import {
  type EnvSchema,
  type FileSpec,
  isTemplate,
} from '../schema/definition.ts';
import {
  type RuleProblem,
  ruleKeys,
  unquoteValue,
  validateValue,
} from '../schema/values.ts';
import {
  type Context,
  contextOf,
  loadContextSchema,
  parseCommand,
} from './common.ts';
import { LIST_HELP, VALIDATE_HELP } from './help.ts';
import type { Io } from './io.ts';
import {
  type EnvFile,
  UNKNOWN_SPEC,
  jsonValue,
  readEnvFile,
} from './target.ts';

/** The schema files the command covers: the --file paths, else all. */
const selectedFiles = (schema: EnvSchema, context: Context): FileSpec[] =>
  schema.files.filter(
    (file) => !context.files || context.files.includes(file.path),
  );

/** The keys the file holds that are not among its schema variables. */
const unknownKeys = (
  schema: EnvSchema,
  file: FileSpec,
  doc: DotenvDocument,
) => {
  const known = new Set(fileKeys(schema, file));
  return keysOf(doc).filter((key) => !known.has(key));
};

/**
 * Validates one held value: a placeholder the file sets on purpose through
 * `values` passes. The error names the rule, never the value.
 */
function checkValue(
  schema: EnvSchema,
  file: FileSpec,
  key: string,
  value: string | undefined,
): string | undefined {
  const literal = file.values?.[key];
  if (literal !== undefined && value === unquoteValue(literal))
    return undefined;
  const result = validateValue(schema.variables[key]!, value);
  return result.ok ? undefined : result.error;
}

// ---------------------------------------------------------------- list

type SetState = 'yes' | 'no' | 'empty';

interface Row {
  file: string;
  key: string;
  set: SetState;
  /** Null when not checked: an unknown key, or a template's placeholder. */
  valid: boolean | null;
  error?: string;
  value?: string;
  masked?: string;
  description?: string;
  unknown?: true;
}

const MAX_VALUE = 40;

const truncate = (text: string) => {
  const chars = [...text];
  return chars.length > MAX_VALUE
    ? `${chars.slice(0, MAX_VALUE - 1).join('')}…`
    : text;
};

/** A broken rule for the VALID column of each key it is reported under. */
const ruleCell = (problem: RuleProblem) =>
  problem.rule === 'conflictsWith'
    ? `set only one of ${ruleKeys(problem).join(', ')}`
    : problem.message;

function rowsOf(schema: EnvSchema, file: EnvFile): Row[] {
  const { spec, doc } = file;
  const template = isTemplate(spec);
  // A key's own rule comes first; a broken rule between variables shows
  // when its value passes.
  const broken = new Map<string, string>();
  for (const problem of fileRules(schema, spec, doc))
    for (const key of ruleKeys(problem))
      if (!broken.has(key)) broken.set(key, ruleCell(problem));
  const row = (key: string, unknown: boolean): Row => {
    const variable = unknown ? UNKNOWN_SPEC : schema.variables[key]!;
    const value = getValue(doc, key);
    const set: SetState =
      value === undefined ? 'no' : value === '' ? 'empty' : 'yes';
    const checked = !unknown && !template;
    const error = checked
      ? (checkValue(schema, spec, key, value) ?? broken.get(key))
      : undefined;
    return {
      file: spec.path,
      key,
      set,
      valid: checked ? !error : null,
      ...(error ? { error } : {}),
      ...(value === undefined ? {} : jsonValue(variable, value)),
      ...(variable.description ? { description: variable.description } : {}),
      ...(unknown ? { unknown: true as const } : {}),
    };
  };
  return [
    ...fileKeys(schema, spec).map((key) => row(key, false)),
    ...unknownKeys(schema, spec, doc).map((key) => row(key, true)),
  ];
}

/** The VALID column: ok, the error, `unknown`, or `-` when not checked. */
const validCell = (row: Row) =>
  row.unknown ? 'unknown' : row.valid === null ? '-' : (row.error ?? 'ok');

/** Rows as columns padded to their widest cell, two spaces apart. */
function table(cells: string[][]): string[] {
  const widths = cells[0]!.map((_, column) =>
    Math.max(...cells.map((line) => [...line[column]!].length)),
  );
  return cells.map((line) =>
    line
      .map(
        (cell, column) => cell + ' '.repeat(widths[column]! - [...cell].length),
      )
      .join('  ')
      .trimEnd(),
  );
}

const LIST_OPTIONS = {} as const;

export async function listCommand(args: string[], io: Io): Promise<number> {
  const options = parseCommand(args, LIST_OPTIONS);
  if (options.help) {
    io.stdout(LIST_HELP);
    return 0;
  }
  const context = await contextOf(io, options);
  const schema = await loadContextSchema(context);
  const files: { file: EnvFile; rows: Row[] }[] = [];
  for (const spec of selectedFiles(schema, context)) {
    const file = await readEnvFile(context, spec);
    files.push({ file, rows: rowsOf(schema, file) });
  }

  if (context.json) {
    io.stdout(JSON.stringify(files.flatMap(({ rows }) => rows)));
    return 0;
  }
  files.forEach(({ file, rows }, index) => {
    if (index > 0) io.stdout('');
    const notes = [
      ...(isTemplate(file.spec) ? ['template'] : []),
      ...(file.exists ? [] : ['missing']),
    ];
    io.stdout(
      notes.length ? `${file.spec.path} (${notes.join(', ')})` : file.spec.path,
    );
    table([
      ['KEY', 'SET', 'VALID', 'VALUE', 'DESCRIPTION'],
      ...rows.map((row) => [
        row.key,
        row.set,
        validCell(row),
        truncate(row.masked ?? row.value ?? ''),
        row.description ?? '',
      ]),
    ]).forEach((line) => io.stdout(line));
  });
  return 0;
}

// ---------------------------------------------------------------- validate

/**
 * One problem: at a key or at a line. A broken rule between variables that
 * is reported under more than one key lists them in `keys`. Never holds a
 * value.
 */
interface Problem {
  key?: string;
  keys?: string[];
  line?: number;
  message: string;
}

interface FileReport {
  path: string;
  template: boolean;
  exists: boolean;
  ok: boolean;
  errors: Problem[];
  warnings: Problem[];
}

const UNKNOWN_MESSAGE = 'is not in the schema for this file';

function validateFile(
  schema: EnvSchema,
  file: EnvFile,
  strict: boolean,
): FileReport {
  const { spec, doc } = file;
  const template = isTemplate(spec);
  const errors: Problem[] = [];
  const warnings: Problem[] = [];
  if (!file.exists) errors.push({ message: 'missing' });
  else {
    for (const line of invalidLineNumbers(doc))
      errors.push({ line, message: 'is not a valid entry' });
    for (const key of fileKeys(schema, spec)) {
      const value = getValue(doc, key);
      // A template holds placeholders: only whether each key is there counts.
      const message = template
        ? value === undefined
          ? 'is missing'
          : undefined
        : checkValue(schema, spec, key, value);
      if (message) errors.push({ key, message });
    }
    for (const problem of fileRules(schema, spec, doc)) {
      const keys = ruleKeys(problem);
      errors.push({
        key: problem.key,
        ...(keys.length > 1 ? { keys } : {}),
        message: problem.message,
      });
    }
    for (const key of unknownKeys(schema, spec, doc))
      (strict ? errors : warnings).push({ key, message: UNKNOWN_MESSAGE });
  }
  return {
    path: spec.path,
    template,
    exists: file.exists,
    ok: !errors.length,
    errors,
    warnings,
  };
}

const problemText = ({ key, keys, line, message }: Problem) =>
  line !== undefined
    ? `line ${line} ${message}`
    : key
      ? `${keys?.join(', ') ?? key}: ${message}`
      : message;

const VALIDATE_OPTIONS = { strict: { type: 'boolean' } } as const;

export async function validateCommand(args: string[], io: Io): Promise<number> {
  const options = parseCommand(args, VALIDATE_OPTIONS);
  if (options.help) {
    io.stdout(VALIDATE_HELP);
    return 0;
  }
  const context = await contextOf(io, options);
  const schema = await loadContextSchema(context);
  const reports: FileReport[] = [];
  for (const spec of selectedFiles(schema, context))
    reports.push(
      validateFile(
        schema,
        await readEnvFile(context, spec),
        Boolean(options.strict),
      ),
    );
  const ok = reports.every((report) => report.ok);

  if (context.json)
    io.stdout(JSON.stringify({ command: 'validate', ok, files: reports }));
  else
    for (const report of reports) {
      const lines = [
        ...report.errors.map(problemText),
        ...report.warnings.map((warning) => `warning: ${problemText(warning)}`),
      ];
      if (!lines.length) io.stdout(`${report.path}: ok`);
      lines.forEach((line) => io.stdout(`${report.path}: ${line}`));
    }
  return ok ? 0 : 1;
}
