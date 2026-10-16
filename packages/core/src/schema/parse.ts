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

const SPACE = /[ \t\n\r]*/y;
const NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
const LITERAL = /true|false|null/y;
const ESCAPE = /\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4})/y;

/** Where JSON text stops being valid JSON, and why. */
interface SyntaxProblem {
  offset: number;
  reason: string;
}

/**
 * Finds the first syntax error in JSON text. Engines word JSON.parse errors
 * differently (V8 names an offset, Firefox a line and column, Safari
 * nothing), so the portal finds the position itself to report it the same
 * in every browser. Iterative, so deep nesting cannot overflow the stack.
 */
function findJsonSyntaxError(text: string): SyntaxProblem | undefined {
  let at = 0;
  const skipSpace = () => {
    SPACE.lastIndex = at;
    SPACE.exec(text);
    at = SPACE.lastIndex;
  };
  const unexpected = (offset: number): SyntaxProblem =>
    offset >= text.length
      ? { offset: text.length, reason: 'unexpected end of the text' }
      : { offset, reason: `unexpected '${text[offset]}'` };
  const match = (pattern: RegExp) => {
    pattern.lastIndex = at;
    return pattern.exec(text) ? pattern.lastIndex : undefined;
  };
  /** Scans a string starting at its quote; undefined when it is valid. */
  const string = (): SyntaxProblem | undefined => {
    at++;
    for (;;) {
      const char = text[at];
      if (char === undefined) return unexpected(at);
      if (char === '"') {
        at++;
        return undefined;
      }
      if (char === '\\') {
        const end = match(ESCAPE);
        if (end === undefined)
          return { offset: at, reason: 'invalid escape in a string' };
        at = end;
      } else if (char < ' ') {
        return {
          offset: at,
          reason: 'line break or control character in a string',
        };
      } else at++;
    }
  };
  /** Scans one scalar, or opens a container; returns its closing bracket. */
  const value = (): SyntaxProblem | '}' | ']' | undefined => {
    skipSpace();
    const char = text[at];
    if (char === '{' || char === '[') {
      at++;
      return char === '{' ? '}' : ']';
    }
    if (char === '"') return string();
    const end = match(NUMBER) ?? match(LITERAL);
    if (end === undefined) {
      // A lone minus sign is wrong at the character after it.
      return unexpected(char === '-' ? at + 1 : at);
    }
    at = end;
    return undefined;
  };

  // Each open container: its closing bracket.
  const open: ('}' | ']')[] = [];
  let expectValue = true;
  for (;;) {
    if (expectValue) {
      const scanned = value();
      if (typeof scanned === 'object') return scanned;
      if (scanned) {
        open.push(scanned);
        skipSpace();
        // An empty container closes at once.
        if (text[at] === scanned) {
          at++;
          open.pop();
        } else if (scanned === '}') {
          if (text[at] !== '"') return unexpected(at);
          const problem = string();
          if (problem) return problem;
          skipSpace();
          if (text[at] !== ':') return unexpected(at);
          at++;
          continue;
        } else continue;
      }
    }
    // After a value: a comma, the closing bracket, or the end of the text.
    skipSpace();
    const close = open.at(-1);
    if (close === undefined)
      return at < text.length ? unexpected(at) : undefined;
    if (text[at] === close) {
      at++;
      open.pop();
      expectValue = false;
      continue;
    }
    if (text[at] !== ',') return unexpected(at);
    at++;
    expectValue = true;
    if (close === '}') {
      skipSpace();
      if (text[at] !== '"') return unexpected(at);
      const problem = string();
      if (problem) return problem;
      skipSpace();
      if (text[at] !== ':') return unexpected(at);
      at++;
    }
  }
}

/** Parses JSON text, reporting a syntax error with its line and column. */
export function parseSchemaText(text: string): SchemaResult {
  // Editors on Windows may save a UTF-8 byte order mark; JSON.parse rejects it.
  if (text.startsWith('\uFEFF')) text = text.slice(1);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    // The scanner and JSON.parse agree on what is valid; if they ever do
    // not, the error is reported at the end of the text.
    const problem = findJsonSyntaxError(text) ?? {
      offset: text.length,
      reason: 'not valid JSON',
    };
    const at = position(text, problem.offset);
    return {
      ok: false,
      errors: [
        {
          path: '(root)',
          ...at,
          message: `invalid JSON at line ${at.line}, column ${at.column}: ${problem.reason}`,
        },
      ],
    };
  }
  return parseSchema(json);
}
