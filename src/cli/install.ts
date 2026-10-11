// `configure-env install skill`: installs the agent skill the package ships,
// for the user or the project, as a symlink or a copy.

import { randomBytes } from 'node:crypto';
import {
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  CliError,
  type Context,
  contextOf,
  displayPath,
  GLOBAL_OPTIONS,
  usageError,
} from './common.ts';
import { INSTALL_HELP } from './help.ts';
import type { Io } from './io.ts';

const { root, ci, json, help } = GLOBAL_OPTIONS;

const OPTIONS = {
  root,
  ci,
  json,
  'no-color': GLOBAL_OPTIONS['no-color'],
  help,
  scope: { type: 'string' },
  mode: { type: 'string' },
  agent: { type: 'string', multiple: true },
  force: { type: 'boolean' },
} as const;

/** What `install` installs. */
const SUBJECTS = ['skill'];

/**
 * The skill folder the package ships: two levels up from src/cli and from
 * dist/cli alike.
 */
export const SKILL_SOURCE = fileURLToPath(
  new URL('../../skills/configure-env', import.meta.url),
);

const SCOPES = ['user', 'project', 'local'] as const;
const MODES = ['symlink', 'copy'] as const;
const AGENTS = ['claude', 'agents'] as const;

type Scope = (typeof SCOPES)[number];
type Mode = (typeof MODES)[number];
type Agent = (typeof AGENTS)[number];

/** Where each agent reads its skills, under the home or the project. */
const SKILL_DIRS: Record<Agent, string> = {
  claude: '.claude/skills/configure-env',
  agents: '.agents/skills/configure-env',
};

const or = (values: readonly string[]) =>
  `${values.slice(0, -1).join(', ')} or ${values.at(-1)}`;

/** `value` when it is one of `values`, else a usage error naming them. */
function oneOf<T extends string>(
  option: string,
  values: readonly T[],
  value: string | undefined,
): T | undefined {
  if (value === undefined || (values as readonly string[]).includes(value))
    return value as T | undefined;
  throw usageError(`${option} must be ${or(values)}, got ${value}`);
}

interface Repository {
  /** The work tree's top level: the folder that holds `.git`. */
  top: string;
  /** The git dir shared by every worktree, which holds info/exclude. */
  common: string;
}

/** A `.git` that leads to no git dir: no usable repository. */
interface Unusable {
  dotGit: string;
}

const isFile = (path: string) =>
  stat(path).then(
    (stats) => stats.isFile(),
    () => false,
  );
const isDir = (path: string) =>
  stat(path).then(
    (stats) => stats.isDirectory(),
    () => false,
  );

/**
 * The common git dir of `gitDir` when it is a git dir, as git checks one: a
 * HEAD file in it, and objects and refs folders in the dir its `commondir`
 * names (a worktree's), else in it. Undefined when it is not one.
 */
async function commonOf(gitDir: string): Promise<string | undefined> {
  const common = await readFile(join(gitDir, 'commondir'), 'utf8').then(
    (text) => resolve(gitDir, text.trim()),
    () => gitDir,
  );
  const valid =
    (await isFile(join(gitDir, 'HEAD'))) &&
    (await isDir(join(common, 'objects'))) &&
    (await isDir(join(common, 'refs')));
  return valid ? common : undefined;
}

const samePath = async (a: string, b: string) =>
  (await realpath(a).catch(() => a)) === (await realpath(b).catch(() => b));

/**
 * Whether the git dir `gitDir` names no other work tree than `top`, as git
 * writes it: a worktree's `gitdir` file holds the path of `top`'s `.git`
 * file, a submodule's config its work tree (`core.worktree`). A git dir
 * that names none, as `git init --separate-git-dir` makes, is `top`'s.
 */
async function pointsBack(gitDir: string, top: string): Promise<boolean> {
  const back = await readFile(join(gitDir, 'gitdir'), 'utf8').catch(
    () => undefined,
  );
  if (back !== undefined)
    return samePath(resolve(gitDir, back.trim()), join(top, '.git'));
  const config = await readFile(join(gitDir, 'config'), 'utf8').catch(() => '');
  const worktree = config.match(/^\s*worktree\s*=\s*(.+?)\s*$/m);
  return worktree ? samePath(resolve(gitDir, worktree[1]!), top) : true;
}

/**
 * The git repository `dir` is in, read from the files, without running git:
 * the nearest `.git` folder, or `.git` file (`gitdir: <path>`, as a worktree,
 * a submodule or a separate git dir has), and the `commondir` a worktree's
 * git dir names. It is trusted only when it leads to a git dir, and a `.git`
 * file only when that git dir names no other work tree; else the nearest
 * `.git` is unusable, and the search stops there, as git does.
 */
async function findRepository(
  dir: string,
): Promise<Repository | Unusable | undefined> {
  for (let top = dir; ; top = dirname(top)) {
    const dotGit = join(top, '.git');
    const stats = await lstat(dotGit).catch(() => undefined);
    if (stats?.isDirectory()) {
      const common = await commonOf(dotGit);
      return common ? { top, common } : { dotGit };
    }
    if (stats?.isFile()) {
      const line = (await readFile(dotGit, 'utf8')).match(/^gitdir:\s*(.+)$/m);
      if (!line) return { dotGit };
      const gitDir = resolve(top, line[1]!.trim());
      const common = await commonOf(gitDir);
      return common && (await pointsBack(gitDir, top))
        ? { top, common }
        : { dotGit };
    }
    if (dirname(top) === top) return undefined;
  }
}

type ExcludeStatus = 'added' | 'present';

/** Adds `entry` to the repository's info/exclude unless a line holds it. */
async function exclude(file: string, entry: string): Promise<ExcludeStatus> {
  const text = await readFile(file, 'utf8').catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return '';
  });
  // A trailing slash would match a folder only, never the symlink.
  const same = new Set([entry, `${entry}/`]);
  if (text.split(/\r?\n/).some((line) => same.has(line.trim())))
    return 'present';
  await mkdir(dirname(file), { recursive: true });
  const separator = text && !text.endsWith('\n') ? '\n' : '';
  await writeFile(file, `${text}${separator}${entry}\n`);
  return 'added';
}

/** Whether `path` is a symlink to `source`. */
const linksTo = async (path: string, source: string) =>
  readlink(path).then(
    (target) => resolve(dirname(path), target) === source,
    () => false,
  );

/**
 * Whether the folder `dir` holds what `source` holds: the same names, folders
 * and file bytes. Any other kind of entry, a symlink among them, differs.
 */
async function sameTree(dir: string, source: string): Promise<boolean> {
  const [mine, theirs] = await Promise.all([
    readdir(dir, { withFileTypes: true }),
    readdir(source, { withFileTypes: true }),
  ]);
  if (mine.length !== theirs.length) return false;
  const byName = new Map(theirs.map((entry) => [entry.name, entry]));
  for (const entry of mine) {
    const other = byName.get(entry.name);
    const [a, b] = [join(dir, entry.name), join(source, entry.name)];
    if (entry.isDirectory() && other?.isDirectory()) {
      if (!(await sameTree(a, b))) return false;
    } else if (entry.isFile() && other?.isFile()) {
      const [x, y] = await Promise.all([readFile(a), readFile(b)]);
      if (!x.equals(y)) return false;
    } else return false;
  }
  return true;
}

type Status = 'installed' | 'linked' | 'unchanged';

/**
 * What is at `target`: nothing, what `mode` would make (the same link, or a
 * folder identical to the skill), or another thing.
 */
async function occupant(
  target: string,
  mode: Mode,
): Promise<'none' | 'same' | 'other'> {
  const existing = await lstat(target).catch(() => undefined);
  if (!existing) return 'none';
  const same =
    mode === 'symlink'
      ? await linksTo(target, SKILL_SOURCE)
      : existing.isDirectory() &&
        (await sameTree(target, SKILL_SOURCE).catch(() => false));
  return same ? 'same' : 'other';
}

/** Removes `path`: a link goes, never what it points at. */
async function remove(path: string): Promise<void> {
  const existing = await lstat(path).catch(() => undefined);
  if (existing?.isSymbolicLink()) await unlink(path);
  else if (existing) await rm(path, { recursive: true, force: true });
}

/** A free path next to `path`, on the same file system so it renames. */
const sibling = (path: string) =>
  join(dirname(path), `.configure-env-${randomBytes(6).toString('hex')}`);

/** A failed swap that could not put the old skill back: it is at `left`. */
class Stranded extends Error {
  constructor(
    readonly reason: unknown,
    readonly left: string,
  ) {
    super((reason as Error).message);
  }
}

/**
 * Copies or links the skill at `target`, replacing what is there. The new
 * one is made next to it and renamed into place, so a failure leaves the
 * old one, never half a copy or nothing; when the old one cannot be put
 * back, a `Stranded` names where it is. `leftover`: the old one, moved
 * aside, when it could not be removed after the swap.
 */
async function place(
  target: string,
  mode: Mode,
): Promise<{ status: Status; leftover?: string }> {
  let leftover: string | undefined;
  await mkdir(dirname(target), { recursive: true });
  const fresh = sibling(target);
  try {
    if (mode === 'symlink')
      // A junction needs no privilege on Windows.
      await symlink(
        SKILL_SOURCE,
        fresh,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    else await cp(SKILL_SOURCE, fresh, { recursive: true });
    if (!(await lstat(target).catch(() => undefined)))
      await rename(fresh, target);
    else {
      const old = sibling(target);
      await rename(target, old);
      try {
        await rename(fresh, target);
      } catch (error) {
        await rename(old, target).catch(() => {
          throw new Stranded(error, old);
        });
        throw error;
      }
      // The skill is in place, but a leftover old one is a second skill
      // agents may load.
      await remove(old).catch(() => (leftover = old));
    }
  } catch (error) {
    await remove(fresh).catch(() => undefined);
    throw error;
  }
  return { status: mode === 'symlink' ? 'linked' : 'installed', leftover };
}

/** One installed skill, as `--json` prints it. */
interface Installed {
  agent: Agent;
  scope: Scope;
  mode: Mode;
  path: string;
  status: Status;
  replaced: boolean;
  exclude?: { file: string; entry: string; status: ExcludeStatus };
}

interface Choices {
  scope: Scope;
  mode: Mode;
  agents: Agent[];
}

/**
 * The scope, mode and agents: the options, else asked in a terminal, else
 * the defaults (project, copy, claude). Undefined when cancelled.
 */
async function choose(
  { prompts }: Context,
  interactive: boolean,
  given: Partial<Choices>,
  repository: Repository | undefined,
): Promise<Choices | undefined> {
  let { scope, mode, agents } = given;
  if (interactive && scope === undefined) {
    // local hides the skill from git, so it needs a repository.
    const scopes = (['project', 'local', 'user'] as const).filter(
      (value) => repository || value !== 'local',
    );
    const hints: Record<Scope, string> = {
      project: 'in the project, committed with it',
      local: 'in the project, kept out of git by .git/info/exclude',
      user: 'in your home, for every project',
    };
    const picked = await prompts.select({
      message: 'Where should the skill go?',
      options: scopes.map((value) => ({ value, hint: hints[value] })),
      initialValue: 'project' as Scope,
    });
    if (prompts.isCancel(picked)) return undefined;
    scope = picked;
  }
  if (interactive && mode === undefined) {
    const picked = await prompts.select({
      message: 'How should the skill be installed?',
      options: [
        { value: 'copy' as Mode, hint: 'survives a fresh clone' },
        { value: 'symlink' as Mode, hint: 'follows package upgrades' },
      ],
      initialValue: 'copy' as Mode,
    });
    if (prompts.isCancel(picked)) return undefined;
    mode = picked;
  }
  if (interactive && agents === undefined) {
    const picked = await prompts.multiselect({
      message: 'Which agents should read it?',
      options: AGENTS.map((value) => ({ value, hint: SKILL_DIRS[value] })),
      initialValues: ['claude' as Agent],
      required: true,
    });
    if (prompts.isCancel(picked)) return undefined;
    agents = picked;
  }
  return {
    scope: scope ?? 'project',
    mode: mode ?? 'copy',
    agents: agents ?? ['claude'],
  };
}

const toSlash = (path: string) => path.split(sep).join('/');

export async function installCommand(args: string[], io: Io): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: OPTIONS,
      strict: true,
      allowPositionals: true,
    });
  } catch (error) {
    throw usageError((error as Error).message);
  }
  const { values: options, positionals } = parsed;
  if (options.help) {
    io.stdout(INSTALL_HELP);
    return 0;
  }
  const [subject, ...extra] = positionals;
  if (subject === undefined)
    throw usageError(`install needs a subject: ${SUBJECTS.join(', ')}`);
  if (!SUBJECTS.includes(subject))
    throw usageError(
      `unknown subject: ${subject}`,
      `configure-env install takes: ${SUBJECTS.join(', ')}`,
    );
  if (extra.length) throw usageError(`unexpected argument: ${extra[0]}`);

  const given: Partial<Choices> = {
    scope: oneOf('--scope', SCOPES, options.scope),
    mode: oneOf('--mode', MODES, options.mode),
    agents: options.agent && [
      ...new Set(
        options.agent.map((agent) => oneOf('--agent', AGENTS, agent)!),
      ),
    ],
  };
  const context = await contextOf(io, options);
  const { prompts } = context;
  const interactive = !context.ci && !context.json && io.isTTY;
  const found = await findRepository(context.root);
  // An unusable .git counts as no repository: project installs at the root.
  const repository = found && 'common' in found ? found : undefined;
  if (given.scope === 'local' && !repository)
    throw usageError(
      `--scope local needs a git repository: ${
        found && 'dotGit' in found
          ? `${found.dotGit} does not lead to one`
          : `${context.root} is in none`
      }`,
      'pass --scope project to install it for the project anyway',
    );

  if (interactive) prompts.intro('configure-env install skill');
  const choices = await choose(context, interactive, given, repository);
  if (!choices) {
    prompts.cancel('Cancelled; nothing was installed.');
    return 130;
  }
  const { scope, mode, agents } = choices;

  const home = io.env.HOME || io.env.USERPROFILE || homedir();
  const base = scope === 'user' ? home : (repository?.top ?? context.root);
  const show = (path: string) =>
    scope === 'user'
      ? `~/${toSlash(relative(home, path))}`
      : toSlash(relative(base, path));

  const targets = [];
  // Every target is checked before any is written: a refused run installs nothing.
  for (const agent of agents) {
    const path = join(base, SKILL_DIRS[agent]);
    const shown = show(path);
    const found = await occupant(path, mode);
    if (found === 'other' && !options.force)
      throw usageError(`${shown} exists; pass --force to replace it`);
    targets.push({ agent, path, shown, found });
  }

  const skills: Installed[] = [];
  const lines: string[] = [];
  const warnings: string[] = [];
  const document = (ok: boolean) => ({
    command: 'install',
    ok,
    source: SKILL_SOURCE,
    skills,
    ...(warnings.length ? { warnings } : {}),
  });
  const warn = () =>
    warnings.forEach((line) => io.stderr(`configure-env: warning: ${line}`));
  /**
   * Fails the run at `path` with exit 1, after reporting the skills already
   * installed, which stay.
   */
  const fail = (path: string, failure: string[]) => {
    if (!context.json) {
      if (interactive && lines.length) prompts.log.success(lines.join('\n'));
      else lines.forEach((line) => io.stdout(line));
      warn();
      throw new CliError(1, failure);
    }
    io.stdout(
      JSON.stringify({
        ...document(false),
        errors: [
          {
            kind: 'file',
            path: displayPath(io.cwd, path),
            message: failure.join('; '),
          },
        ],
      }),
    );
    return 1;
  };
  const why = (error: unknown): string =>
    error instanceof Stranded
      ? why(error.reason)
      : ((error as NodeJS.ErrnoException).code ?? (error as Error).message);

  for (const { agent, path, shown, found } of targets) {
    let status: Status = 'unchanged';
    try {
      if (found !== 'same') {
        const done = await place(path, mode);
        status = done.status;
        if (done.leftover)
          warnings.push(
            `the previous skill was left at ${show(done.leftover)}; delete it, or an agent may load it as a second skill`,
          );
      }
    } catch (error) {
      return fail(path, [
        `cannot install ${shown}: ${why(error)}`,
        ...(error instanceof Stranded
          ? [
              `the previous skill was left at ${show(error.left)}; move it back to ${shown}`,
            ]
          : []),
      ]);
    }
    const placed = { status, replaced: found === 'other' };
    const suffix = placed.replaced ? `${mode}, replaced` : mode;
    lines.push(`${placed.status.padEnd(10)} ${shown} (${suffix})`);
    const skill = { agent, scope, mode, path, ...placed };
    if (scope !== 'local' || !repository) {
      skills.push(skill);
      continue;
    }
    const file = join(repository.common, 'info', 'exclude');
    const entry = `/${toSlash(relative(repository.top, path))}`;
    let excluded: ExcludeStatus;
    try {
      excluded = await exclude(file, entry);
    } catch (error) {
      skills.push(skill);
      return fail(file, [
        `cannot update ${file}: ${why(error)}`,
        `${shown} was installed; add ${entry} to it yourself`,
      ]);
    }
    if (excluded === 'added')
      lines.push(
        `excluded   ${entry} in ${toSlash(relative(repository.top, file))}`,
      );
    skills.push({ ...skill, exclude: { file, entry, status: excluded } });
  }

  if (context.json) io.stdout(JSON.stringify(document(true)));
  else {
    if (interactive) prompts.outro(lines.join('\n'));
    else lines.forEach((line) => io.stdout(line));
    warn();
  }
  return 0;
}
