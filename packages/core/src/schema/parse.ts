// Validates an env schema: parsed JSON, or JSON text. No file access, so the
// portal runs the same checks in the browser; load.ts reads the file.

import type { z } from 'zod';
import { type EnvSchema, envSchema } from './definition.ts';

/** One problem, at a path like `files[1].variables[0]`. */
export interface SchemaError {
  path: string;
  message: string;
  /** 1-based position of a JSON syntax error. */
  line?: number;
  column?: number;
}

export type SchemaResult =
  { ok: true; schema: EnvSchema } | { ok: false; errors: SchemaError[] };

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** `['files', 1, 'variables', 0]` as `files[1].variables[0]`; `(root)` when empty. */
export function formatIssuePath(path: readonly PropertyKey[]): string {
  let out = '';
  for (const key of path) {
    if (typeof key === 'number') out += `[${key}]`;
    else if (typeof key === 'string' && IDENTIFIER.test(key))
      out += out ? `.${key}` : key;
    else out += `[${JSON.stringify(String(key))}]`;
  }
  return out || '(root)';
}

/** A record key failure carries the key schema's message one level down. */
function issueMessage(issue: z.core.$ZodIssue): string {
  if (issue.code === 'invalid_key' && issue.issues[0])
    return issue.issues[0].message;
  return issue.message;
}

/** Validates parsed JSON as an env schema. */
export function parseSchema(json: unknown): SchemaResult {
  const result = envSchema.safeParse(json);
  if (result.success) return { ok: true, schema: result.data };
  return {
    ok: false,
    errors: result.error.issues.map((issue) => ({
      path: formatIssuePath(issue.path),
      message: issueMessage(issue),
    })),
  };
}

/** The 1-based line and column of a character offset. */
function position(text: string, offset: number) {
  const before = text.slice(0, offset).split('\n');
  return { line: before.length, column: (before.at(-1)?.length ?? 0) + 1 };
}

/** Parses JSON text, reporting a syntax error with its line and column. */
export function parseSchemaText(text: string): SchemaResult {
  // Editors on Windows may save a UTF-8 byte order mark; JSON.parse rejects it.
  if (text.startsWith('\uFEFF')) text = text.slice(1);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    const message = (error as Error).message;
    // V8 names the offset ("... in JSON at position 42"); input that ends
    // early has none, so the error is at its end.
    const offset = /at position (\d+)/.exec(message)?.[1];
    const at = position(
      text,
      offset === undefined ? text.length : Number(offset),
    );
    const reason = message.replace(/\s*(in JSON )?at position \d+.*$/, '');
    return {
      ok: false,
      errors: [
        {
          path: '(root)',
          ...at,
          message: `invalid JSON at line ${at.line}, column ${at.column}: ${reason}`,
        },
      ],
    };
  }
  return parseSchema(json);
}
