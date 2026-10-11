// `configure-env install skill`: installs the agent skill the package ships,
// for the user or the project, as a symlink or a copy.

import {
  cp,
  lstat,
  mkdir,
  readFile,
  readlink,
  rm,
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

/**
 * The git repository `dir` is in, read from the files, without running git:
 * the nearest `.git` folder, or `.git` file (`gitdir: <path>`, as a worktree
 * or a submodule has), and the `commondir` a worktree's git dir names.
 */
async function findRepository(dir: string): Promise<Repository | undefined> {
  for (let top = dir; ; top = dirname(top)) {
    const dotGit = join(top, '.git');
    const stats = await lstat(dotGit).catch(() => undefined);
    if (stats?.isDirectory()) return { top, common: dotGit };
    if (stats?.isFile()) {
      const line = (await readFile(dotGit, 'utf8')).match(/^gitdir:\s*(.+)$/m);
      if (line) {
        const gitDir = resolve(top, line[1]!.trim());
        const common = await readFile(join(gitDir, 'commondir'), 'utf8').then(
          (text) => resolve(gitDir, text.trim()),
          () => gitDir,
        );
        return { top, common };
      }
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

type Status = 'installed' | 'linked' | 'unchanged';

/** What is at `target`: nothing, the same link `mode` would make, or another thing. */
async function occupant(
  target: string,
  mode: Mode,
): Promise<'none' | 'same' | 'other'> {
  const existing = await lstat(target).catch(() => undefined);
  if (!existing) return 'none';
  return mode === 'symlink' && (await linksTo(target, SKILL_SOURCE))
    ? 'same'
    : 'other';
}

/** Copies or links the skill at `target`, removing what is there first. */
async function place(target: string, mode: Mode): Promise<Status> {
  const existing = await lstat(target).catch(() => undefined);
  // A link goes, never what it points at.
  if (existing?.isSymbolicLink()) await unlink(target);
  else if (existing) await rm(target, { recursive: true, force: true });
  await mkdir(dirname(target), { recursive: true });
  if (mode === 'symlink') {
    // A junction needs no privilege on Windows.
    await symlink(
      SKILL_SOURCE,
      target,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    return 'linked';
  }
  await cp(SKILL_SOURCE, target, { recursive: true });
  return 'installed';
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
  const repository = await findRepository(context.root);
  if (given.scope === 'local' && !repository)
    throw usageError(
      `--scope local needs a git repository: ${context.root} is in none`,
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

  const skills = [];
  const lines: string[] = [];
  for (const { agent, path, shown, found } of targets) {
    let status: Status = 'unchanged';
    try {
      if (found !== 'same') status = await place(path, mode);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      throw new CliError(1, [
        `cannot install ${shown}: ${code ?? (error as Error).message}`,
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
      const code = (error as NodeJS.ErrnoException).code;
      throw new CliError(1, [
        `cannot update ${file}: ${code ?? (error as Error).message}`,
        `${shown} was installed; add ${entry} to it yourself`,
      ]);
    }
    if (excluded === 'added')
      lines.push(
        `excluded   ${entry} in ${toSlash(relative(repository.top, file))}`,
      );
    skills.push({ ...skill, exclude: { file, entry, status: excluded } });
  }

  if (context.json)
    io.stdout(
      JSON.stringify({
        command: 'install',
        ok: true,
        source: SKILL_SOURCE,
        skills,
      }),
    );
  else if (interactive) prompts.outro(lines.join('\n'));
  else lines.forEach((line) => io.stdout(line));
  return 0;
}
