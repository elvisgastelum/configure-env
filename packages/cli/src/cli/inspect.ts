// `configure-env list`: a read-only view of the values the env files hold
// now, checked against the schema. `check` reports their problems. It runs
// through the configure-env API (connect.ts): GET /api/variables, whose
// files hold each key as list shows it, secrets masked.

import { type EnvSchema, type FileSpec } from '@configure-env/core';
import { parseCommand } from './common.ts';
import { type ProjectRun, openProject } from './connect.ts';
import { LIST_HELP } from './help.ts';
import type { Io } from './io.ts';
import {
  type ListedFile,
  type ListedKey,
  UNKNOWN_SPEC,
  listFiles,
  listedFile,
} from './target.ts';

/** The schema files the command covers: the --file paths, else all. */
const selectedFiles = (schema: EnvSchema, run: ProjectRun): FileSpec[] =>
  schema.files.filter((file) => !run.files || run.files.includes(file.path));

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

/** A listed key as a row: its value as `value`, or as `masked` for a secret. */
function rowOf(schema: EnvSchema, file: ListedFile, entry: ListedKey): Row {
  const variable = entry.unknown ? UNKNOWN_SPEC : schema.variables[entry.key]!;
  return {
    file: file.path,
    key: entry.key,
    set: entry.set,
    valid: entry.valid,
    ...(entry.error ? { error: entry.error } : {}),
    ...(entry.value === undefined
      ? {}
      : variable.secret
        ? { masked: entry.value }
        : { value: entry.value }),
    ...(variable.description ? { description: variable.description } : {}),
    ...(entry.unknown ? { unknown: true as const } : {}),
  };
}

/** The VALID column: ok, the error, `unknown`, or `-` when not checked. */
const validCell = (row: Row) =>
  row.unknown ? 'unknown' : row.valid === null ? '-' : (row.error ?? 'ok');

/** Rows as columns padded to their widest cell, two spaces apart. */
export function table(cells: string[][]): string[] {
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
  const run = await openProject(io, options);
  const { schema } = run;
  const connection = await run.connect();
  let listed: ListedFile[];
  try {
    listed = await listFiles(run, connection);
  } finally {
    await connection.close();
  }
  const files = selectedFiles(schema, run).map((spec) => {
    const file = listedFile(listed, spec);
    return { file, rows: file.keys.map((entry) => rowOf(schema, file, entry)) };
  });

  if (run.json) {
    io.stdout(JSON.stringify(files.flatMap(({ rows }) => rows)));
    return 0;
  }
  files.forEach(({ file, rows }, index) => {
    if (index > 0) io.stdout('');
    const notes = [
      ...(file.template ? ['template'] : []),
      ...(file.exists ? [] : ['missing']),
    ];
    io.stdout(notes.length ? `${file.path} (${notes.join(', ')})` : file.path);
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
