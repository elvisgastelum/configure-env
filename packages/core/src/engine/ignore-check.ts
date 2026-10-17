// What check reports about git: a state directory whose .gitignore does not
// keep the state out of it, and an env file holding real values that git
// does not ignore. fixGitignore writes the lines that fix them.

import { execFile } from 'node:child_process';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { devNull } from 'node:os';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import {
  DEFAULT_STATE_PATH,
  STATE_GITIGNORE_COMMENT,
  isStateDir,
  stateIgnoreEntries,
} from './state.ts';

export const GITIGNORE_CODES = [
  'state-not-ignored',
  'file-not-ignored',
] as const;

export type GitignoreCode = (typeof GITIGNORE_CODES)[number];

/**
 * A file git could commit that it must not: the state's (its directory is
 * `path`), or an env file at `path`. The fix adds `entries` to `gitignore`;
 * `blocked` says why it will not: that .gitignore is a symlink, which may
 * lead outside the root. Paths are relative to the root, with `/`.
 */
export interface GitignoreProblem {
  severity: 'error';
  code: GitignoreCode;
  path: string;
  gitignore: string;
  entries: string[];
  message: string;
  blocked?: 'symlink';
}

export interface GitignoreOptions {
  root: string;
  /** The env files that hold real values, relative to the root. */
  files: readonly string[];
  /** The state database, relative to the root or absolute. */
  statePath?: string;
}

const slashed = (path: string) => path.split(sep).join('/');

type Existing =
  | { kind: 'missing' }
  | { kind: 'symlink' }
  | { kind: 'file'; text: string };

/** The .gitignore at `path`: missing, a symlink, or its text. */
async function existing(path: string): Promise<Existing> {
  const stats = await lstat(path).catch(() => undefined);
  if (!stats) return { kind: 'missing' };
  if (stats.isSymbolicLink()) return { kind: 'symlink' };
  return { kind: 'file', text: await readFile(path, 'utf8') };
}

const linesOf = (text: string) =>
  new Set(text.split(/\r?\n/).map((line) => line.trim()));

/** The state directory's problem, when it is ours and lacks an entry. */
async function stateProblem(
  root: string,
  statePath: string,
): Promise<GitignoreProblem | undefined> {
  const path = resolve(root, statePath);
  const dir = dirname(path);
  if (!isStateDir(dir)) return undefined;
  const stats = await lstat(dir).catch(() => undefined);
  if (!stats?.isDirectory()) return undefined;
  const shown = slashed(relative(root, dir));
  const problem = {
    severity: 'error' as const,
    code: 'state-not-ignored' as const,
    path: shown,
    gitignore: `${shown}/.gitignore`,
  };
  const entries = stateIgnoreEntries(path);
  const file = await existing(join(dir, '.gitignore'));
  if (file.kind === 'symlink')
    return {
      ...problem,
      entries,
      message: 'its .gitignore is a symlink',
      blocked: 'symlink',
    };
  if (file.kind === 'missing')
    return {
      ...problem,
      entries,
      message: 'no .gitignore keeps the state out of git',
    };
  const lines = linesOf(file.text);
  if (lines.has('*')) return undefined;
  const missing = entries.filter(
    (entry) => !lines.has(entry) && !lines.has(`/${entry}`),
  );
  if (!missing.length) return undefined;
  return {
    ...problem,
    entries: missing,
    message: `its .gitignore does not ignore ${missing.join(', ')}`,
  };
}

/** Runs git in `root` with `input` on stdin, its environment variables left out. */
function git(
  root: string,
  args: string[],
  input = '',
): Promise<{ code: number; stdout: string }> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
  );
  return new Promise((done) => {
    const child = execFile('git', args, { cwd: root, env }, (error, stdout) => {
      const code = error
        ? typeof error.code === 'number'
          ? error.code
          : -1
        : 0;
      done({ code, stdout });
    });
    // git may exit before it reads stdin; the callback reports it.
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(input);
  });
}

/** The line that ignores `path` only, relative to the root's .gitignore. */
const ignoreLine = (path: string) =>
  `/${path.replace(/[\\*?[\]]/g, '\\$&').replace(/^[#!]/, '\\$&')}`;

/**
 * The env files git does not ignore: none outside a git work tree, or when
 * git cannot run. Only the repository's ignore rules count, not the
 * person's global excludes file, which a clone elsewhere does not have.
 */
async function unignored(
  root: string,
  files: readonly string[],
): Promise<string[]> {
  const paths = files.filter((path) => !path.startsWith('../'));
  if (!paths.length) return [];
  const inside = await git(root, ['rev-parse', '--is-inside-work-tree']);
  if (inside.code !== 0 || inside.stdout.trim() !== 'true') return [];
  const checked = await git(
    root,
    [
      '-c',
      `core.excludesFile=${devNull}`,
      'check-ignore',
      '--no-index',
      '--stdin',
      '-z',
    ],
    paths.map((path) => `${path}\0`).join(''),
  );
  // 0: some are ignored, 1: none is; anything else, git could not tell.
  if (checked.code !== 0 && checked.code !== 1) return [];
  const ignored = new Set(checked.stdout.split('\0').filter(Boolean));
  return paths.filter((path) => !ignored.has(path));
}

/**
 * What check reports about git: the state directory (only one named
 * .configure-env, as the state writes its .gitignore into) when its
 * .gitignore is missing or lacks one of the state's files, then each env
 * file git does not ignore. Writes nothing.
 */
export async function gitignoreProblems({
  root,
  files,
  statePath = DEFAULT_STATE_PATH,
}: GitignoreOptions): Promise<GitignoreProblem[]> {
  const state = await stateProblem(root, statePath);
  const loose = await unignored(root, files);
  const rootIgnore =
    loose.length > 0 ? await existing(join(root, '.gitignore')) : undefined;
  return [
    ...(state ? [state] : []),
    ...loose.map((path): GitignoreProblem => ({
      severity: 'error',
      code: 'file-not-ignored',
      path,
      gitignore: '.gitignore',
      entries: [ignoreLine(path)],
      message: 'not git-ignored; its values could be committed',
      ...(rootIgnore?.kind === 'symlink'
        ? { blocked: 'symlink' as const }
        : {}),
    })),
  ];
}

/** A .gitignore fixGitignore wrote: created, or appended to. */
export interface GitignoreFix {
  gitignore: string;
  created: boolean;
  added: string[];
}

export interface GitignoreFixResult {
  fixed: GitignoreFix[];
  /** The problems it left: blocked, or a .gitignore that became a symlink. */
  skipped: GitignoreProblem[];
}

/**
 * Adds each problem's entries to its .gitignore, a line each, creating the
 * file when it is missing (the state's with its comment line) and leaving
 * out a line it already has. Never writes through a symlink, nor a file
 * that is not a .gitignore inside the root: a blocked problem, or one whose
 * .gitignore is a symlink by now or lies elsewhere, is skipped.
 */
export async function fixGitignore(
  root: string,
  problems: readonly GitignoreProblem[],
): Promise<GitignoreFixResult> {
  const skipped: GitignoreProblem[] = [];
  const byFile = new Map<string, GitignoreProblem[]>();
  for (const problem of problems) {
    if (problem.blocked) skipped.push(problem);
    else
      byFile.set(problem.gitignore, [
        ...(byFile.get(problem.gitignore) ?? []),
        problem,
      ]);
  }
  const fixed: GitignoreFix[] = [];
  for (const [gitignore, group] of byFile) {
    const path = resolve(root, gitignore);
    const inside = relative(root, path);
    // Only a .gitignore inside the root, whoever built the problem.
    const ours =
      basename(path) === '.gitignore' &&
      !inside.startsWith('..') &&
      !isAbsolute(inside);
    const file = ours ? await existing(path) : { kind: 'symlink' as const };
    if (file.kind === 'symlink') {
      skipped.push(...group);
      continue;
    }
    const text = file.kind === 'file' ? file.text : '';
    const lines = linesOf(text);
    const added = [
      ...new Set(group.flatMap((problem) => problem.entries)),
    ].filter((entry) => !lines.has(entry));
    if (!added.length) continue;
    const state = group.some((problem) => problem.code === 'state-not-ignored');
    const opening =
      file.kind === 'missing' && state ? [STATE_GITIGNORE_COMMENT] : [];
    const separator = text && !text.endsWith('\n') ? '\n' : '';
    await writeFile(
      path,
      `${text}${separator}${[...opening, ...added].join('\n')}\n`,
      { flag: file.kind === 'missing' ? 'wx' : 'w' },
    );
    fixed.push({ gitignore, created: file.kind === 'missing', added });
  }
  return { fixed, skipped };
}
