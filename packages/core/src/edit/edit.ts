// The per-key edits behind `set` and `unset`: change one file's variables in
// place, keeping every other byte, and settle its protected values with the
// state. Every outcome is a typed result; nothing is printed or thrown for a
// refusal, so the CLI and the API server each report it their own way.

import { fileRules } from '../engine/check.ts';
import {
  appendLines,
  getValue,
  parseDotenv,
  removeEntry,
  serialize,
  setValue,
} from '../engine/dotenv.ts';
import { commentLines, entryComment, groupChanges } from '../engine/plan.ts';
import {
  type EnvSchema,
  type FileSpec,
  VARIABLE_NAME,
  type VariableSpec,
} from '../schema/definition.ts';
import {
  formatValue,
  ruleKeys,
  unquoteValue,
  validateValue,
} from '../schema/values.ts';
import {
  type EnvFile,
  UNKNOWN_SPEC,
  variablesOf,
  writeEnvFile,
} from './file.ts';
import {
  type ProtectedProblem,
  type RunState,
  type StateAccess,
  checksOf,
  protectVerdict,
  writeProtected,
} from './protect.ts';

/** What an edit runs against. */
export interface EditContext extends StateAccess {
  schema: EnvSchema;
  /** The state as the run read it at its start; none when nothing is protected. */
  run?: RunState | undefined;
}

/** The options both edits take. */
export interface EditOptions {
  /** The protected keys the edit may replace. */
  replace?: ReadonlySet<string>;
  /**
   * Asked once with the protected keys the edit would replace, before
   * anything is written; false writes nothing. When given, only the keys it
   * was asked about may be replaced; without it, every `replace` key may.
   */
  confirm?: (keys: string[]) => Promise<boolean>;
}

/**
 * Why an edit wrote nothing: values that break their rules (`invalid`),
 * protected values it may not change, a `confirm` that said no, a state it
 * could not get or use, or an env file it could not write.
 */
export type EditFailure =
  | { ok: false; kind: 'invalid'; messages: string[] }
  | { ok: false; kind: 'protected'; problems: ProtectedProblem[] }
  | { ok: false; kind: 'cancelled' }
  | { ok: false; kind: 'state'; path: string; lines: string[] }
  | { ok: false; kind: 'write'; message: string };

/** What an edit did; a state write that failed after the file is `stateError`. */
export interface Edited<E> {
  ok: true;
  file: string;
  keys: E[];
  /** The protected keys it replaced. */
  replaced: string[];
  stateError?: string[];
}

export type SetStatus = 'updated' | 'added' | 'unchanged';

/** A key `setValues` set: the spec it was checked against and its plain value. */
export interface SetEntry {
  key: string;
  status: SetStatus;
  spec: VariableSpec;
  plain: string;
}

export interface UnsetEntry {
  key: string;
  status: 'removed' | 'absent';
}

/** `KEY=VALUE` pairs in order; a later pair for a key replaces an earlier one. */
export function parsePairs(
  positionals: readonly string[],
): { ok: true; pairs: Map<string, string> } | { ok: false; message: string } {
  const pairs = new Map<string, string>();
  for (const pair of positionals) {
    const at = pair.indexOf('=');
    if (at < 1)
      return { ok: false, message: `set takes KEY=VALUE, got ${pair}` };
    const key = pair.slice(0, at);
    if (!VARIABLE_NAME.test(key))
      return { ok: false, message: `${key}: is not a valid variable name` };
    pairs.delete(key);
    pairs.set(key, pair.slice(at + 1));
  }
  return { ok: true, pairs };
}

/** A key's spec for this file, or undefined when it is not one of its variables. */
const specFor = (schema: EnvSchema, file: FileSpec, key: string) =>
  variablesOf(schema, file).has(key) ? schema.variables[key] : undefined;

/** The comment lines above a new key, as the engine writes them. */
function newEntryLines(
  schema: EnvSchema,
  file: FileSpec,
  key: string,
  written: string,
): string[] {
  const comment = variablesOf(schema, file).has(key)
    ? entryComment(schema, file, key)
    : undefined;
  return [...(comment ? commentLines(comment) : []), `${key}=${written}`];
}

/** Appends a key: after a blank line when it has a comment and follows lines. */
function appendKey(file: EnvFile, lines: string[]) {
  const separate = lines.length > 1 && file.doc.lines.length > 0;
  appendLines(file.doc, separate ? ['', ...lines] : lines);
}

/** Thrown inside the guarded write when the env file is not written. */
class NotWritten {
  constructor(readonly message: string) {}
}

/**
 * Writes the file and records the protected values it holds; in the
 * state's write transaction when the run has anything to settle with it, so the state
 * never learns a value that was not written. `allowed` are the keys the
 * edit may replace.
 */
async function writeAndRecord(
  context: EditContext,
  file: EnvFile,
  allowed: ReadonlySet<string>,
  write: boolean,
): Promise<
  | { ok: true; replaced: string[]; stateError?: string[] }
  | Exclude<EditFailure, { kind: 'invalid' | 'cancelled' }>
> {
  const { spec, doc } = file;
  const before = parseDotenv(file.previous ?? '');
  try {
    const result = await writeProtected(
      context,
      context.schema,
      context.run,
      {
        checks: checksOf(
          context.schema,
          spec,
          (key) => getValue(before, key),
          (key) => getValue(doc, key),
        ),
        files: [{ spec, valueOf: (key) => getValue(doc, key) }],
        replace: allowed,
      },
      async () => {
        if (write) {
          const written = await writeEnvFile(file, serialize(doc));
          if (!written.ok) throw new NotWritten(written.message);
        }
        return {
          value: undefined,
          done: [spec.path],
          written: write ? [spec.path] : [],
        };
      },
    );
    if (!result.ok) return result;
    return {
      ok: true,
      replaced: result.replaced.map((entry) => entry.key),
      ...(result.stateError ? { stateError: result.stateError } : {}),
    };
  } catch (error) {
    if (error instanceof NotWritten)
      return { ok: false, kind: 'write', message: error.message };
    throw error;
  }
}

/**
 * Settles the replacements with `confirm` and writes the edit: the keys
 * replaced early are confirmed, and those (else every `replace` key) are the
 * ones the guarded write may replace.
 */
async function confirmAndWrite(
  context: EditContext,
  file: EnvFile,
  options: EditOptions,
  replaced: readonly string[],
  write: boolean,
) {
  const { replace = new Set<string>(), confirm } = options;
  if (confirm && replaced.length && !(await confirm([...replaced])))
    return { ok: false, kind: 'cancelled' } as const;
  return writeAndRecord(
    context,
    file,
    confirm ? new Set(replaced) : replace,
    write,
  );
}

/**
 * Sets `pairs` in `file`: each value is checked against its variable (a key
 * the file does not list is a plain string), then every protected change
 * and every rule between variables that names a key it sets, before
 * anything is written. A new file starts with the schema's header; a new
 * key takes its comment. `kept` keys hold the value the file already has:
 * checked as they are, never reformatted.
 */
export async function setValues(
  context: EditContext,
  file: EnvFile,
  pairs: ReadonlyMap<string, string>,
  options: EditOptions & { kept?: ReadonlySet<string> } = {},
): Promise<Edited<SetEntry> | EditFailure> {
  const { schema } = context;
  const { spec } = file;
  const { replace = new Set<string>(), kept = new Set<string>() } = options;

  // Validate everything before touching the file: one bad value writes nothing.
  const written = new Map<
    string,
    { spec: VariableSpec; text: string; plain: string }
  >();
  const errors: string[] = [];
  for (const [key, raw] of pairs) {
    const variable = specFor(schema, spec, key);
    if (variable && kept.has(key)) {
      // A kept value is checked like any other, and never shown: it may be
      // the secret the file already holds.
      const result = validateValue(variable, raw);
      if (!result.ok) {
        errors.push(`${key}: ${result.error}; unset it to generate a new one`);
        continue;
      }
      // `raw` is the value the file holds: equal to it, the entry reports
      // unchanged and its line is never rewritten, so no formatting applies.
      written.set(key, { spec: variable, text: raw, plain: raw });
      continue;
    }
    if (!variable) {
      const text = formatValue(UNKNOWN_SPEC, raw);
      written.set(key, { spec: UNKNOWN_SPEC, text, plain: raw });
      continue;
    }
    const result = validateValue(variable, raw);
    if (!result.ok) {
      errors.push(`${key}: ${result.error}`);
      continue;
    }
    const text = formatValue(variable, result.value);
    written.set(key, { spec: variable, text, plain: unquoteValue(text) });
  }
  if (errors.length) return { ok: false, kind: 'invalid', messages: errors };

  if (!file.exists && spec.header)
    appendLines(file.doc, [...commentLines(spec.header), '']);
  const keys: SetEntry[] = [];
  const refused: ProtectedProblem[] = [];
  const replaced: string[] = [];
  for (const [key, { spec: variable, text, plain }] of written) {
    const current = getValue(file.doc, key);
    const verdict = protectVerdict(
      schema,
      context.run?.state,
      spec,
      key,
      current,
      plain,
      replace,
    );
    if (verdict.action === 'refuse') {
      refused.push(verdict.problem);
      continue;
    }
    if (verdict.action === 'replace') replaced.push(key);
    let status: SetStatus;
    if (current === undefined) {
      appendKey(file, newEntryLines(schema, spec, key, text));
      status = 'added';
    } else if (current === plain) status = 'unchanged';
    else {
      setValue(file.doc, key, text);
      status = 'updated';
    }
    keys.push({ key, status, spec: variable, plain });
  }
  if (refused.length)
    return { ok: false, kind: 'protected', problems: refused };
  // The rules between variables, over the values the file would hold: one
  // that names a key this edit sets and breaks writes nothing.
  const broken = fileRules(schema, spec, file.doc).filter((problem) =>
    [problem.key, ...problem.others].some((key) => written.has(key)),
  );
  if (broken.length)
    return {
      ok: false,
      kind: 'invalid',
      messages: broken.map(
        (problem) => `${ruleKeys(problem).join(', ')}: ${problem.message}`,
      ),
    };

  const outcome = await confirmAndWrite(
    context,
    file,
    options,
    replaced,
    keys.some((entry) => entry.status !== 'unchanged'),
  );
  if (!outcome.ok) return outcome;
  return { ...outcome, file: spec.path, keys };
}

/**
 * Removes `keys` from `file`, each with the comment lines the engine wrote
 * above it. Every protected key is checked before any is removed, and the
 * replacements are confirmed before anything is written.
 */
export async function unsetValues(
  context: EditContext,
  file: EnvFile,
  keys: Iterable<string>,
  options: EditOptions = {},
): Promise<Edited<UnsetEntry> | EditFailure> {
  const { schema } = context;
  const { spec } = file;
  const { replace = new Set<string>() } = options;
  const unique = new Set(keys);
  const refused: ProtectedProblem[] = [];
  const replaced: string[] = [];
  for (const key of unique) {
    const current = getValue(file.doc, key);
    if (current === undefined) continue;
    const verdict = protectVerdict(
      schema,
      context.run?.state,
      spec,
      key,
      current,
      undefined,
      replace,
    );
    if (verdict.action === 'refuse') refused.push(verdict.problem);
    if (verdict.action === 'replace') replaced.push(key);
  }
  if (refused.length)
    return { ok: false, kind: 'protected', problems: refused };

  const report: UnsetEntry[] = [];
  for (const key of unique) {
    const known = specFor(schema, spec, key) !== undefined;
    const comment = known ? entryComment(schema, spec, key) : undefined;
    const removed = removeEntry(
      file.doc,
      key,
      comment ? commentLines(comment) : [],
      groupChanges(schema),
    );
    report.push({ key, status: removed ? 'removed' : 'absent' });
  }
  const outcome = await confirmAndWrite(
    context,
    file,
    options,
    replaced,
    report.some((entry) => entry.status === 'removed'),
  );
  if (!outcome.ok) return outcome;
  return { ...outcome, file: spec.path, keys: report };
}
