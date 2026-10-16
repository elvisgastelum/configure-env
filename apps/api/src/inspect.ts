// Read-only views of the env files against the schema: the values per
// variable, the files with their drift, a single revealed value, and the
// check and validate reports, which report the protected values that no
// longer match the state, as the CLI does. Nothing here writes, and nothing
// but `revealValue` returns a secret unmasked.

import {
  type DotenvDocument,
  type EnvSchema,
  type FileSpec,
  type RuleProblem,
  type State,
  checkDrift,
  fileKeys,
  fileRules,
  formatMode,
  getValue,
  invalidLineNumbers,
  isTemplate,
  keysOf,
  maskValue,
  protectedMismatches,
  readEnvFile,
  ruleKeys,
  unquoteValue,
  validateValue,
} from '@configure-env/core';
import type { z } from 'zod';
import type {
  checkResponse,
  fileContentResponse,
  fileInfo,
  fileValue,
  filesResponse,
  revealResponse,
  validateResponse,
  variablesResponse,
} from './contracts.ts';
import { maskedLines } from './diff.ts';
import { contentFingerprint } from './fingerprint.ts';
import { ApiError } from './http.ts';

type FileValue = z.output<typeof fileValue>;
type FileInfo = z.output<typeof fileInfo>;
type FileValidation = z.output<typeof validateResponse>['files'][number];
type Problem = FileValidation['errors'][number];

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

/** Each variable's spec and its status in every file that lists it. */
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
  };
}

/** Each schema file: its policy, mode, drift and the lines that do not parse. */
export async function listFiles(
  schema: EnvSchema,
  root: string,
): Promise<z.output<typeof filesResponse>> {
  const [files, report] = await Promise.all([
    readAll(schema, root),
    checkDrift({ schema, root, strict: true }),
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
        drift: {
          status: drift.status,
          drift: drift.drift,
          missingKeys: drift.missingKeys,
          unknownKeys: drift.unknownKeys,
        },
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

/** Drift and invalid values per file, as `configure-env check` reports them. */
export async function checkProject(
  schema: EnvSchema,
  root: string,
  strict: boolean,
  state?: State,
): Promise<z.output<typeof checkResponse>> {
  return checkDrift({ schema, root, strict, ...(state ? { state } : {}) });
}

const UNKNOWN_MESSAGE = 'is not in the schema for this file';

function validateFile(
  schema: EnvSchema,
  file: Read,
  strict: boolean,
  state: State | undefined,
): FileValidation {
  const { spec } = file;
  const template = isTemplate(spec);
  const errors: Problem[] = [];
  const warnings: Problem[] = [];
  if (!file.ok) errors.push({ message: file.message });
  else if (!file.exists) errors.push({ message: 'missing' });
  else {
    const { doc } = file;
    for (const line of invalidLineNumbers(doc))
      errors.push({ line, message: 'is not a valid entry' });
    for (const key of fileKeys(schema, spec)) {
      const value = getValue(doc, key);
      // A template holds placeholders: only whether each key is there counts.
      const message = template
        ? value === undefined
          ? 'is missing'
          : undefined
        : valueError(schema, spec, key, value);
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
    errors.push(...protectedMismatches(schema, state, spec, doc));
    const known = new Set(fileKeys(schema, spec));
    for (const key of keysOf(doc).filter((key) => !known.has(key)))
      (strict ? errors : warnings).push({ key, message: UNKNOWN_MESSAGE });
  }
  return {
    path: spec.path,
    template,
    exists: file.ok && file.exists,
    ok: !errors.length,
    errors,
    warnings,
  };
}

/** Rule and value errors per file, as `configure-env validate` reports them. */
export async function validateProject(
  schema: EnvSchema,
  root: string,
  strict: boolean,
  state?: State,
): Promise<z.output<typeof validateResponse>> {
  const files = (await readAll(schema, root)).map((file) =>
    validateFile(schema, file, strict, state),
  );
  return { ok: files.every((file) => file.ok), files };
}
