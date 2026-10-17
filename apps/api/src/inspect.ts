// Read-only views of the env files against the schema: the values per
// variable, the files with their drift and a single revealed value. The
// check report is core's checkDrift, as the CLI gives it. Nothing here
// writes, and nothing but `revealValue` returns a secret unmasked.

import {
  type DotenvDocument,
  type EnvSchema,
  type FileSpec,
  type FileCheck,
  type RuleProblem,
  UNKNOWN_SPEC,
  checkDrift,
  fileKeys,
  fileRules,
  formatMode,
  getValue,
  invalidLineNumbers,
  isTemplate,
  maskValue,
  readEnvFile,
  ruleKeys,
  unknownKeys,
  unquoteValue,
  validateValue,
} from '@configure-env/core';
import type { z } from 'zod';
import type {
  fileContentResponse,
  fileInfo,
  fileValue,
  filesResponse,
  listedFile,
  listedKey,
  groupsResponse,
  revealResponse,
  variablesResponse,
} from './contracts.ts';
import { maskedLines } from './diff.ts';
import { contentFingerprint } from './fingerprint.ts';
import { ApiError } from './http.ts';

type FileValue = z.output<typeof fileValue>;
type ListedFile = z.output<typeof listedFile>;
type ListedKey = z.output<typeof listedKey>;
type FileInfo = z.output<typeof fileInfo>;

/** Thrown for a file or key the project does not have, or a refused path. */
export class InspectError extends ApiError {
  constructor(statusCode: 404 | 403, message: string) {
    super(statusCode, message);
  }
}

/** A file as read, or why its path was refused. */
type Read =
  | {
      ok: true;
      spec: FileSpec;
      exists: boolean;
      mode?: number;
      doc: DotenvDocument;
      fingerprint: string | null;
    }
  | { ok: false; spec: FileSpec; message: string };

async function readFile(root: string, spec: FileSpec): Promise<Read> {
  const result = await readEnvFile(root, spec);
  if (!result.ok) return { ok: false, spec, message: result.message };
  const { exists, mode, doc, previous } = result.file;
  return {
    ok: true,
    spec,
    exists,
    doc,
    fingerprint: contentFingerprint(previous),
    ...(mode === undefined ? {} : { mode }),
  };
}

const readAll = (schema: EnvSchema, root: string) =>
  Promise.all(schema.files.map((spec) => readFile(root, spec)));

/**
 * Why a held value is invalid: its own rule, else a rule between variables
 * it breaks. A placeholder the file sets on purpose passes. Never the value.
 */
function valueError(
  schema: EnvSchema,
  spec: FileSpec,
  key: string,
  value: string | undefined,
): string | undefined {
  const literal = spec.values?.[key];
  if (literal !== undefined && value === unquoteValue(literal))
    return undefined;
  const result = validateValue(schema.variables[key]!, value);
  return result.ok ? undefined : result.error;
}

const ruleMessage = (problem: RuleProblem) =>
  problem.rule === 'conflictsWith'
    ? `set only one of ${ruleKeys(problem).join(', ')}`
    : problem.message;

type Group = z.output<typeof groupsResponse>['groups'][number];

/**
 * The variables by group heading, in schema order; the ungrouped ones last.
 * The portal's mock copies it as `groupsOf` in apps/web/src/mocks/store.ts;
 * change both together.
 */
export function listGroups(schema: EnvSchema): z.output<typeof groupsResponse> {
  const groups = new Map<string | null, Group>();
  for (const [name, spec] of Object.entries(schema.variables)) {
    const heading = spec.group ?? null;
    let group = groups.get(heading);
    if (!group) {
      group = {
        name: heading,
        variables: [],
        required: 0,
        secret: 0,
        protected: 0,
      };
      groups.set(heading, group);
    }
    group.variables.push(name);
    if (spec.required) group.required++;
    if (spec.secret) group.secret++;
    if (spec.protected !== undefined) group.protected++;
  }
  const ungrouped = groups.get(null);
  groups.delete(null);
  return { groups: [...groups.values(), ...(ungrouped ? [ungrouped] : [])] };
}

/**
 * A file's keys as `configure-env list` shows them: its variables in schema
 * order, each checked (a missing value too, against `required` and the
 * rules between variables), then the keys it holds that the schema does not
 * list for it. A template's placeholders are not checked. Secrets masked.
 */
function listedFileOf(schema: EnvSchema, file: Read): ListedFile {
  const { spec } = file;
  const template = isTemplate(spec);
  if (!file.ok)
    return {
      path: spec.path,
      template,
      exists: false,
      error: file.message,
      keys: [],
    };
  const broken = new Map<string, string>();
  for (const problem of fileRules(schema, spec, file.doc))
    for (const key of ruleKeys(problem))
      if (!broken.has(key)) broken.set(key, ruleMessage(problem));
  const entry = (key: string, unknown: boolean): ListedKey => {
    const variable = unknown ? UNKNOWN_SPEC : schema.variables[key]!;
    const value = getValue(file.doc, key);
    const checked = !unknown && !template;
    const error = checked
      ? (valueError(schema, spec, key, value) ?? broken.get(key))
      : undefined;
    return {
      key,
      set: value === undefined ? 'no' : value === '' ? 'empty' : 'yes',
      valid: checked ? !error : null,
      ...(error ? { error } : {}),
      ...(value === undefined ? {} : { value: maskValue(variable, value) }),
      ...(unknown ? { unknown: true as const } : {}),
    };
  };
  return {
    path: spec.path,
    template,
    exists: file.exists,
    fingerprint: file.fingerprint,
    keys: [
      ...fileKeys(schema, spec).map((key) => entry(key, false)),
      ...unknownKeys(schema, spec, file.doc).map((key) => entry(key, true)),
    ],
  };
}

/** Each variable's spec and its status in every file that lists it, and each file's keys. */
export async function listVariables(
  schema: EnvSchema,
  root: string,
): Promise<z.output<typeof variablesResponse>> {
  const files = await readAll(schema, root);
  const values = new Map<string, FileValue[]>(
    Object.keys(schema.variables).map((name) => [name, []]),
  );
  for (const file of files) {
    const { spec } = file;
    const broken = new Map<string, string>();
    if (file.ok && !isTemplate(spec))
      for (const problem of fileRules(schema, spec, file.doc))
        for (const key of ruleKeys(problem))
          if (!broken.has(key)) broken.set(key, ruleMessage(problem));
    for (const key of fileKeys(schema, spec)) {
      const variable = schema.variables[key]!;
      const value = file.ok ? getValue(file.doc, key) : undefined;
      let entry: FileValue;
      if (!file.ok)
        entry = { file: spec.path, status: 'missing', error: file.message };
      else if (value === undefined)
        entry = { file: spec.path, status: 'missing' };
      else {
        // A template holds placeholders, not values to check.
        const error = isTemplate(spec)
          ? undefined
          : (valueError(schema, spec, key, value) ?? broken.get(key));
        const shown = maskValue(variable, value);
        entry = {
          file: spec.path,
          status: error ? 'invalid' : variable.secret ? 'masked' : 'set',
          value: shown,
          ...(error ? { error } : {}),
        };
      }
      values.get(key)!.push(entry);
    }
  }
  return {
    variables: Object.entries(schema.variables).map(([name, spec]) => ({
      name,
      spec,
      files: values.get(name)!,
    })),
    files: files.map((file) => listedFileOf(schema, file)),
  };
}

const keysWith = (file: FileCheck, code: string) =>
  file.problems.flatMap((problem) =>
    problem.code === code && problem.key ? [problem.key] : [],
  );

/**
 * A file's drift from its check: whether apply (with --prune) would change
 * it, the keys a merge file lacks and the keys prune would remove.
 */
function driftOf(file: FileCheck): FileInfo['drift'] {
  const missingKeys =
    file.status === 'missing-keys' ? keysWith(file, 'missing-key') : [];
  // A generate file is rewritten whole: its unknown keys are its content.
  const unknownKeys =
    file.policy === 'generate' ? [] : keysWith(file, 'unknown-key');
  const content =
    file.status !== 'current' &&
    !(file.status === 'missing' && file.policy === 'create-only');
  return {
    status: file.status,
    drift: content || Boolean(file.mode) || unknownKeys.length > 0,
    missingKeys,
    unknownKeys,
  };
}

/** Each schema file: its policy, mode, drift and the lines that do not parse. */
export async function listFiles(
  schema: EnvSchema,
  root: string,
): Promise<z.output<typeof filesResponse>> {
  const [files, report] = await Promise.all([
    readAll(schema, root),
    checkDrift({ schema, root }),
  ]);
  return {
    files: files.map((file): FileInfo => {
      const { spec } = file;
      const drift = report.files.find((entry) => entry.path === spec.path)!;
      const lines = file.ok ? invalidLineNumbers(file.doc) : [];
      return {
        path: spec.path,
        policy: spec.policy,
        template: isTemplate(spec),
        exists: file.ok && file.exists,
        mode: {
          expected: spec.mode ?? null,
          actual:
            file.ok && file.mode !== undefined ? formatMode(file.mode) : null,
        },
        drift: driftOf(drift),
        parseErrors: lines.map((line) => ({
          line,
          message: 'is not a valid entry',
        })),
        ...(file.ok
          ? { fingerprint: file.fingerprint }
          : { error: file.message }),
      };
    }),
  };
}

/** One schema file as GET /api/files describes it: for a 409 body. */
export async function fileInfoOf(
  schema: EnvSchema,
  root: string,
  path: string,
): Promise<FileInfo> {
  const { files } = await listFiles(schema, root);
  return files.find((file) => file.path === path)!;
}

/** One value as the file holds it, unmasked. Only the file's own variables. */
export async function revealValue(
  schema: EnvSchema,
  root: string,
  path: string,
  key: string,
): Promise<z.output<typeof revealResponse>> {
  const spec = schema.files.find((file) => file.path === path);
  if (!spec) throw new InspectError(404, `${path} is not a schema file`);
  if (!fileKeys(schema, spec).includes(key))
    throw new InspectError(404, `${key} is not one of ${path}'s variables`);
  const file = await readFile(root, spec);
  if (!file.ok) throw new InspectError(403, file.message);
  return { file: path, key, value: getValue(file.doc, key) ?? null };
}

/** One schema file's lines as it holds them, every secret value masked. */
export async function fileContent(
  schema: EnvSchema,
  root: string,
  path: string,
): Promise<z.output<typeof fileContentResponse>> {
  const spec = schema.files.find((file) => file.path === path);
  if (!spec) throw new InspectError(404, `${path} is not a schema file`);
  const result = await readEnvFile(root, spec);
  if (!result.ok) throw new InspectError(403, result.message);
  const { exists, previous } = result.file;
  return {
    file: path,
    exists,
    lines: exists ? maskedLines(schema, previous ?? '') : [],
  };
}
