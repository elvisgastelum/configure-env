import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { mergeMissingKeys, missingKeys } from './env-file.ts';
import {
  EXAMPLE_KEYS,
  type EnvValues,
  type ExampleKey,
  renderExampleBlock,
  renderProductionExample,
} from './template.ts';

export const PRODUCTION_EXAMPLE_PATH = 'deploy/.env.production.example';
export const EXAMPLE_PATH = '.env.example';
export const LOCAL_PATH = '.env';
const TEMPLATE_SOURCE = 'packages/configure-env/src/template.ts';

/** The files the tool manages, in the order it handles them. */
export type Target = 'production' | 'example' | 'local';
export const TARGETS: readonly Target[] = ['production', 'example', 'local'];

const PATHS: Record<Target, string> = {
  production: PRODUCTION_EXAMPLE_PATH,
  example: EXAMPLE_PATH,
  local: LOCAL_PATH,
};

export interface FileChange {
  target: Target;
  /** Relative to the root. */
  path: string;
  action: 'created' | 'updated' | 'unchanged' | 'added';
  /** The keys appended, for `added`. */
  addedKeys: ExampleKey[];
  /** The new content; set only when the file is to be written. */
  content?: string;
  /** Why an existing file is left alone. */
  note?: string;
}

export interface Plan {
  root: string;
  changes: FileChange[];
}

/** The file's content, or undefined when it does not exist. */
async function readIfExists(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function planTarget(
  root: string,
  target: Target,
  values: Readonly<EnvValues>,
): Promise<FileChange> {
  const path = PATHS[target];
  const current = await readIfExists(join(root, path));
  const change = { target, path, addedKeys: [] as ExampleKey[] };
  switch (target) {
    case 'production': {
      const content = renderProductionExample();
      if (current === content) return { ...change, action: 'unchanged' };
      const action = current === undefined ? 'created' : 'updated';
      return { ...change, action, content };
    }
    case 'example': {
      if (current === undefined) {
        const content = renderExampleBlock(EXAMPLE_KEYS);
        return { ...change, action: 'created', content };
      }
      const { content, added } = mergeMissingKeys(current, EXAMPLE_KEYS);
      if (!added.length) return { ...change, action: 'unchanged' };
      return { ...change, action: 'added', addedKeys: added, content };
    }
    case 'local': {
      if (current !== undefined) {
        const note = 'exists; never overwritten';
        return { ...change, action: 'unchanged', note };
      }
      const content = renderExampleBlock(EXAMPLE_KEYS, values);
      return { ...change, action: 'created', content };
    }
  }
}

/** What a run would do to each target, without writing anything. */
export async function planChanges({
  root,
  targets,
  values,
}: {
  root: string;
  targets: readonly Target[];
  values: Readonly<EnvValues>;
}): Promise<Plan> {
  const ordered = TARGETS.filter((target) => targets.includes(target));
  const changes = await Promise.all(
    ordered.map((target) => planTarget(root, target, values)),
  );
  return { root, changes };
}

/** One output line: `path: created`, `path: added keys: A B`, ... */
export function describeChange(change: FileChange): string {
  const status =
    change.action === 'added'
      ? `added keys: ${change.addedKeys.join(' ')}`
      : change.action;
  return `${change.path}: ${status}${change.note ? ` (${change.note})` : ''}`;
}

/**
 * Writes the planned contents. The local .env is created with mode 600 and
 * never replaces a file, even one created after planning.
 */
export async function applyPlan(root: string, plan: Plan): Promise<void> {
  for (const change of plan.changes) {
    if (change.content === undefined) continue;
    const path = join(root, change.path);
    await mkdir(dirname(path), { recursive: true });
    if (change.target === 'local') {
      await writeFile(path, change.content, { mode: 0o600, flag: 'wx' });
      // The mode above is subject to the umask; this is not.
      await chmod(path, 0o600);
    } else {
      await writeFile(path, change.content);
    }
  }
}

/** For `--check`: whether the examples are current, one line per file. */
export async function checkDrift(
  root: string,
): Promise<{ drift: boolean; lines: string[] }> {
  const lines: string[] = [];
  let drift = false;

  const production = await readIfExists(join(root, PRODUCTION_EXAMPLE_PATH));
  if (production === renderProductionExample()) {
    lines.push(`${PRODUCTION_EXAMPLE_PATH}: current`);
  } else {
    drift = true;
    lines.push(
      production === undefined
        ? `${PRODUCTION_EXAMPLE_PATH}: missing`
        : `${PRODUCTION_EXAMPLE_PATH}: differs from the template in ${TEMPLATE_SOURCE}`,
    );
  }

  const example = await readIfExists(join(root, EXAMPLE_PATH));
  const missing =
    example === undefined ? [] : missingKeys(example, EXAMPLE_KEYS);
  if (example === undefined) {
    drift = true;
    lines.push(`${EXAMPLE_PATH}: missing`);
  } else if (missing.length) {
    drift = true;
    lines.push(`${EXAMPLE_PATH}: missing keys: ${missing.join(' ')}`);
  } else {
    lines.push(`${EXAMPLE_PATH}: current`);
  }

  return { drift, lines };
}
