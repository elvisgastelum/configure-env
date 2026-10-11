// Plans what a run does to each env file the schema lists, without writing
// anything: the content each file should hold, and why.

import { readFile, realpath } from 'node:fs/promises';
import {
  type EnvSchema,
  type FilePolicy,
  type FileSpec,
  isTemplate,
  protectedReason,
  ruleNames,
} from '../schema/definition.ts';
import { formatValue, validateValue } from '../schema/values.ts';
import {
  type DotenvDocument,
  appendLines,
  keysOf,
  parseDotenv,
  removeEntry,
  serialize,
} from './dotenv.ts';
import { resolveTarget } from './paths.ts';

/** `mode`: the content is current, only the permissions change. */
export type FileAction = 'create' | 'update' | 'mode' | 'unchanged' | 'skip';

export interface FilePlan {
  /** As the schema writes it, relative to the root. */
  path: string;
  policy: FilePolicy;
  action: FileAction;
  /** The keys the new content adds to the file. */
  addedKeys: string[];
  /** The keys `prune` removes from the file, each with its comment block. */
  prunedKeys?: string[];
  /**
   * Why a file is skipped: `exists` (create-only), `refused` (unsafe path) or
   * `loosens` (its schema mode would add permissions).
   */
  reason?: 'exists' | 'refused' | 'loosens';
  /** Why the path was refused, or the mode not loosened. */
  error?: string;
  /** The permissions to write with: the schema's, else the file's, else 644. */
  mode: number;
  /** The permissions the file has now; absent when it does not exist. */
  currentMode?: number;
  /** Whether the schema sets the mode, so a differing one is drift. */
  modeFixed?: boolean;
  /** What the file holds after the run; absent for a skipped file. */
  content?: string;
  /** What the file holds now; absent when it does not exist. */
  previous?: string;
  /** The absolute path; empty for a refused one. */
  target: string;
}

/** A problem that stops the plan from being applied. Never holds a value. */
export type PlanError =
  | {
      kind: 'value';
      key: string;
      /** Every key a broken rule between variables names, when more than one. */
      keys?: string[];
      message: string;
    }
  | { kind: 'file'; path: string; message: string };

export type ValueError = Extract<PlanError, { kind: 'value' }>;

export interface Plan {
  /** The real path of the project root. */
  root: string;
  files: FilePlan[];
  errors: PlanError[];
}

export interface PlanOptions {
  schema: EnvSchema;
  /** The project root the file paths are relative to. */
  root: string;
  /**
   * Raw values by variable name, as a person or the environment gives them.
   * Template files never take them.
   */
  values: Readonly<Record<string, string>>;
  /** Only these schema paths; every file when absent. */
  files?: readonly string[];
  /**
   * Removes the keys a merge or existing create-only file holds that the
   * schema does not list for it, with their comment blocks.
   */
  prune?: boolean;
}

/** Permissions as three octal digits, like `600`. */
export const formatMode = (mode: number) => mode.toString(8).padStart(3, '0');

/** Whether going from `current` to `mode` adds a permission bit. */
export const loosens = (current: number, mode: number) =>
  (mode & ~current) !== 0;

/** The file's variable names in output order. */
export const fileKeys = (schema: EnvSchema, file: FileSpec): string[] =>
  file.variables === '*' ? Object.keys(schema.variables) : file.variables;

/** The keys the document holds that the schema does not list for the file. */
export const unknownKeys = (
  schema: EnvSchema,
  file: FileSpec,
  doc: DotenvDocument,
): string[] => {
  const known = new Set(fileKeys(schema, file));
  return keysOf(doc).filter((key) => !known.has(key));
};

/** A comment as `#` lines, one per line of text. */
export const commentLines = (text: string) =>
  text.split('\n').map((line) => (line ? `# ${line}` : '#'));

/**
 * The comment written above a key in the file: the file's or the variable's
 * own, then `required unless X is set` for a `requiredUnless` that names
 * variables the file lists, then `protected: <reason>` (or `protected`) for
 * a protected variable.
 */
export function entryComment(
  schema: EnvSchema,
  file: FileSpec,
  key: string,
): string | undefined {
  const spec = schema.variables[key];
  const own = file.comments?.[key] ?? spec?.comment;
  const keys = fileKeys(schema, file);
  const alternatives = ruleNames(spec?.requiredUnless).filter((name) =>
    keys.includes(name),
  );
  const rule = alternatives.length
    ? `required unless ${alternatives.join(' or ')} is set`
    : undefined;
  const reason = spec && protectedReason(spec);
  const guard =
    spec?.protected === undefined
      ? undefined
      : reason
        ? `protected: ${reason}`
        : 'protected';
  const lines = [own, rule, guard].filter(Boolean);
  return lines.length ? lines.join('\n') : undefined;
}

/**
 * Whether a blank line sets the entry `below` apart from `above`, as
 * entryLines writes them: their groups differ.
 */
export function groupChanges(schema: EnvSchema) {
  const group = (key: string) =>
    Object.hasOwn(schema.variables, key)
      ? schema.variables[key]!.group
      : undefined;
  return (above: string, below: string) => group(above) !== group(below);
}

/**
 * Validates the given values; each valid one in the form written after
 * `KEY=`. Errors name the rule, never the value.
 */
export function validateValues(
  schema: EnvSchema,
  values: Readonly<Record<string, string>>,
): { written: Map<string, string>; errors: ValueError[] } {
  const written = new Map<string, string>();
  const errors: ValueError[] = [];
  for (const [key, raw] of Object.entries(values)) {
    const spec = schema.variables[key];
    if (!spec) {
      errors.push({
        kind: 'value',
        key,
        message: 'is not declared in the schema',
      });
      continue;
    }
    const result = validateValue(spec, raw);
    if (result.ok) written.set(key, formatValue(spec, result.value));
    else errors.push({ kind: 'value', key, message: result.error });
  }
  return { written, errors };
}

type Writer = (key: string) => string;

/**
 * Comment and `KEY=value` lines for `keys`: a blank line starts a new block
 * where the group changes or a variable has a comment.
 */
function entryLines(
  schema: EnvSchema,
  file: FileSpec,
  keys: readonly string[],
  write: Writer,
): string[] {
  const lines: string[] = [];
  let group: string | undefined;
  keys.forEach((key, index) => {
    const spec = schema.variables[key]!;
    const comment = entryComment(schema, file, key);
    if (index > 0 && (comment || spec.group !== group)) lines.push('');
    if (comment) lines.push(...commentLines(comment));
    lines.push(`${key}=${write(key)}`);
    group = spec.group;
  });
  return lines;
}

/** The whole file: the header, a blank line, then the entries. */
function render(
  schema: EnvSchema,
  file: FileSpec,
  write: Writer,
  eol: string,
): string {
  const lines = file.header ? commentLines(file.header) : [];
  const entries = entryLines(schema, file, fileKeys(schema, file), write);
  if (lines.length && entries.length) lines.push('');
  lines.push(...entries);
  return lines.length ? lines.join(eol) + eol : '';
}

async function planFile(
  schema: EnvSchema,
  realRoot: string,
  file: FileSpec,
  given: Map<string, string>,
  prune: boolean,
): Promise<{ plan: FilePlan; error?: PlanError }> {
  const base = { path: file.path, policy: file.policy, addedKeys: [] };
  const schemaMode = file.mode ? Number.parseInt(file.mode, 8) : undefined;
  const target = await resolveTarget(realRoot, file.path);
  if (!target.ok) {
    return {
      plan: {
        ...base,
        action: 'skip',
        reason: 'refused',
        error: target.message,
        mode: schemaMode ?? 0o644,
        target: '',
      },
      error: { kind: 'file', path: file.path, message: target.message },
    };
  }

  const previous = target.exists
    ? await readFile(target.absolute, 'utf8')
    : undefined;
  const mode = schemaMode ?? target.mode ?? 0o644;
  const common = {
    ...base,
    mode,
    previous,
    target: target.absolute,
    ...(target.exists ? { currentMode: target.mode } : {}),
    ...(schemaMode === undefined ? {} : { modeFixed: true }),
  };
  // A file whose content is current only takes the schema mode: a chmod
  // that never adds a permission.
  const current = (fallback: FilePlan): { plan: FilePlan } => {
    if (target.mode === undefined || target.mode === mode)
      return { plan: fallback };
    const plan = { ...common, content: previous };
    if (!loosens(target.mode, mode))
      return { plan: { ...plan, action: 'mode' } };
    const error = `mode not loosened (${formatMode(target.mode)}, schema says ${formatMode(mode)})`;
    return { plan: { ...plan, action: 'skip', reason: 'loosens', error } };
  };
  const keys = fileKeys(schema, file);
  // A template is committed: no given value (a secret, say) may reach it.
  const template = isTemplate(file);
  const write: Writer = (key) => {
    const literal = file.values?.[key];
    if (literal !== undefined) return literal;
    const value = template ? undefined : given.get(key);
    if (value !== undefined) return value;
    const spec = schema.variables[key]!;
    return spec.default === undefined ? '' : formatValue(spec, spec.default);
  };

  if (previous === undefined) {
    const content = render(schema, file, write, '\n');
    return { plan: { ...common, action: 'create', addedKeys: keys, content } };
  }
  const doc = parseDotenv(previous);
  const present = new Set(keysOf(doc));
  const missing = keys.filter((key) => !present.has(key));
  // A generate file is rewritten, so it holds no unknown key to prune.
  const pruned =
    prune && file.policy !== 'generate' ? unknownKeys(schema, file, doc) : [];
  for (const key of pruned) removeEntry(doc, key, 'any', groupChanges(schema));
  const prunedKeys = pruned.length ? { prunedKeys: pruned } : {};

  switch (file.policy) {
    case 'generate': {
      const content = render(schema, file, write, doc.eol);
      if (content === previous)
        return current({ ...common, action: 'unchanged', content });
      return {
        plan: { ...common, action: 'update', addedKeys: missing, content },
      };
    }
    case 'merge': {
      if (!missing.length && !pruned.length)
        return current({ ...common, action: 'unchanged', content: previous });
      if (missing.length) {
        const lines = entryLines(schema, file, missing, write);
        appendLines(doc, doc.lines.length ? ['', ...lines] : lines);
      }
      const content = serialize(doc);
      return {
        plan: {
          ...common,
          action: 'update',
          addedKeys: missing,
          ...prunedKeys,
          content,
        },
      };
    }
    case 'create-only': {
      if (!pruned.length)
        return current({ ...common, action: 'skip', reason: 'exists' });
      const content = serialize(doc);
      return { plan: { ...common, action: 'update', ...prunedKeys, content } };
    }
  }
}

/** What a run would do to each file, in schema order. Writes nothing. */
export async function planChanges({
  schema,
  root,
  values,
  files,
  prune = false,
}: PlanOptions): Promise<Plan> {
  const realRoot = await realpath(root);
  const validated = validateValues(schema, values);
  const { written } = validated;
  const errors: PlanError[] = validated.errors;
  for (const path of files ?? []) {
    if (!schema.files.some((file) => file.path === path))
      errors.push({ kind: 'file', path, message: 'is not in the schema' });
  }
  const selected = schema.files.filter(
    (file) => !files || files.includes(file.path),
  );
  const planned: FilePlan[] = [];
  for (const file of selected) {
    const { plan, error } = await planFile(
      schema,
      realRoot,
      file,
      written,
      prune,
    );
    planned.push(plan);
    if (error) errors.push(error);
  }
  return { root: realRoot, files: planned, errors };
}
