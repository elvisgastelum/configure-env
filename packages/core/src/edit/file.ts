// One schema file as the per-key edits see it: reading it, and writing it
// back atomically.

import { readFile, realpath } from 'node:fs/promises';
import { applyPlan } from '../engine/apply.ts';
import { type DotenvDocument, parseDotenv } from '../engine/dotenv.ts';
import { resolveTarget } from '../engine/paths.ts';
import { type FilePlan, fileKeys } from '../engine/plan.ts';
import type {
  EnvSchema,
  FileSpec,
  VariableSpec,
} from '../schema/definition.ts';

/** A schema file as it is on disk now. */
export interface EnvFile {
  spec: FileSpec;
  /** The real project root. */
  root: string;
  absolute: string;
  exists: boolean;
  /** The current permissions; absent when the file does not exist. */
  mode?: number;
  /** The current content; absent when the file does not exist. */
  previous?: string;
  /** The parsed content; empty when the file does not exist. */
  doc: DotenvDocument;
}

/** Reads a schema file under `root`; a path that is not safe to use is an error. */
export async function readEnvFile(
  root: string,
  spec: FileSpec,
): Promise<{ ok: true; file: EnvFile } | { ok: false; message: string }> {
  const real = await realpath(root);
  const target = await resolveTarget(real, spec.path);
  if (!target.ok)
    return { ok: false, message: `${spec.path}: ${target.message}` };
  const previous = target.exists
    ? await readFile(target.absolute, 'utf8')
    : undefined;
  return {
    ok: true,
    file: {
      spec,
      root: real,
      absolute: target.absolute,
      exists: target.exists,
      ...(target.mode === undefined ? {} : { mode: target.mode }),
      ...(previous === undefined ? {} : { previous }),
      doc: parseDotenv(previous ?? ''),
    },
  };
}

/**
 * Writes `content` atomically: an existing file keeps its mode, a new one
 * takes the schema's (else 644). A file changed since it was read is not
 * written.
 */
export async function writeEnvFile(
  file: EnvFile,
  content: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { spec } = file;
  const schemaMode = spec.mode ? Number.parseInt(spec.mode, 8) : undefined;
  const plan: FilePlan = {
    path: spec.path,
    policy: spec.policy,
    action: file.exists ? 'update' : 'create',
    addedKeys: [],
    mode: file.mode ?? schemaMode ?? 0o644,
    content,
    target: file.absolute,
    ...(file.previous === undefined ? {} : { previous: file.previous }),
  };
  const [result] = await applyPlan({
    root: file.root,
    files: [plan],
    errors: [],
  });
  return result?.ok
    ? { ok: true }
    : { ok: false, message: `${spec.path}: not written: ${result?.error}` };
}

/** A key that is not one of the file's variables: a plain string. */
export const UNKNOWN_SPEC: VariableSpec = {
  type: 'string',
  required: false,
  secret: false,
};

/** The file's variables in output order. */
export const variablesOf = (schema: EnvSchema, file: FileSpec) =>
  new Set(fileKeys(schema, file));
