// Plan, then apply: POST /api/plan shows what a run would do to each file,
// with masked diffs and a fingerprint, writing nothing; POST /api/apply
// plans again from the same inputs and writes that plan only when its
// fingerprint is still the one shown, so a stale preview is never applied.
// Protected values are settled with the state as `configure-env apply`
// settles them, and every changed key is recorded in the history, as the
// CLI's when the CLI sends the request. With `generate` or `defer` they run
// apply's checks too (src/run.ts); a value generated for a plan is kept in
// memory for a while by the plan's fingerprint, so the apply writes the
// value the plan showed. It is never answered or logged, and the apply that
// names the plan takes it, whatever it answers.

import { createHash } from 'node:crypto';
import {
  type ChangeActor,
  type EnvSchema,
  type FilePlan,
  type Plan,
  type PlanError,
  type ProtectedCheck,
  type RunFile,
  type RunState,
  appliedChanges,
  applyPlan,
  checksOf,
  displayPath,
  formatMode,
  getValue,
  keptWarning,
  loadState,
  maskValue,
  parseDotenv,
  planChanges,
  protectsAny,
  recordHistory,
  verdictsOf,
  writeProtected,
} from '@configure-env/core';
import type { z } from 'zod';
import type {
  applyRequest,
  applyResponse,
  planRequest,
  planResponse,
} from './contracts.ts';
import { fileDiff } from './diff.ts';
import { contentFingerprint } from './fingerprint.ts';
import { ApiError } from './http.ts';
import type { Project } from './project.ts';
import {
  checkGenerated,
  checkInputs,
  generateFor,
  leftIn,
  neededKeys,
  requiredErrors,
  ruleErrors,
  withGenerated,
} from './run.ts';

type PlanInputs = z.output<typeof planRequest>;
type PlanView = z.output<typeof planResponse>;

/** A schema that parsed, with the fingerprint of its bytes. */
interface ReadSchema {
  schema: EnvSchema;
  fingerprint: string;
}

const sha256 = (text: string) =>
  `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;

/**
 * The plan's fingerprint: the schema it came from and, per file, what it
 * holds now and what it would hold after, with the mode. Equal fingerprints
 * write equal bytes.
 */
function planFingerprint(schemaFingerprint: string, plan: Plan): string {
  return sha256(
    JSON.stringify({
      schema: schemaFingerprint,
      files: plan.files.map((file) => [
        file.path,
        file.action,
        file.mode,
        contentFingerprint(file.previous),
        contentFingerprint(file.content),
        file.prunedKeys ?? [],
      ]),
      errors: plan.errors,
    }),
  );
}

/** The protected checks of the files a run writes, and the values it keeps. */
function runChecks(schema: EnvSchema, plan: Plan) {
  const checks: ProtectedCheck[] = [];
  const files: RunFile[] = [];
  for (const file of plan.files) {
    if (file.reason === 'refused') continue;
    const spec = schema.files.find((entry) => entry.path === file.path)!;
    const content = file.content ?? file.previous;
    if (content !== undefined) {
      const doc = parseDotenv(content);
      files.push({ spec, valueOf: (key) => getValue(doc, key) });
    }
    if (file.action !== 'create' && file.action !== 'update') continue;
    const before =
      file.previous === undefined ? undefined : parseDotenv(file.previous);
    const after = parseDotenv(file.content ?? '');
    checks.push(
      ...checksOf(
        schema,
        spec,
        (key) => before && getValue(before, key),
        (key) => getValue(after, key),
      ),
    );
  }
  return { checks, files };
}

/** What paths in messages are relative to: the CLI's directory, else the root. */
const cwdOf = (project: Project) => project.cwd ?? project.root;

/** How long a generated value waits for the apply of its plan. */
const GENERATED_TTL_MS = 15 * 60_000;
/** The most plans whose generated values wait at once; the oldest goes first. */
const GENERATED_PLANS = 64;
/** The most plans remembered as gone, with only why; the oldest goes first. */
const GONE_PLANS = 256;

/** Why the values a plan generated are not held: past 15 minutes, or dropped for newer plans. */
type Gone = 'expired' | 'evicted';

/**
 * The values generated for the plans of one server, by fingerprint, and the
 * plans whose values are gone, by fingerprint, with only why: never a value.
 */
interface GeneratedStore {
  held: Map<string, { values: Record<string, string>; at: number }>;
  gone: Map<string, Gone>;
}

/** Each server's store: its memory only, so a restart holds none. */
const stores = new WeakMap<Project, GeneratedStore>();

function storeOf(project: Project): GeneratedStore {
  let store = stores.get(project);
  if (!store) {
    store = { held: new Map(), gone: new Map() };
    stores.set(project, store);
  }
  return store;
}

function forget(store: GeneratedStore, fingerprint: string, why: Gone) {
  store.held.delete(fingerprint);
  store.gone.delete(fingerprint);
  store.gone.set(fingerprint, why);
  while (store.gone.size > GONE_PLANS)
    store.gone.delete(store.gone.keys().next().value!);
}

function keepGenerated(
  project: Project,
  fingerprint: string,
  values: Record<string, string>,
) {
  const store = storeOf(project);
  const now = Date.now();
  for (const [key, entry] of store.held)
    if (now - entry.at > GENERATED_TTL_MS) forget(store, key, 'expired');
  store.held.delete(fingerprint);
  store.gone.delete(fingerprint);
  store.held.set(fingerprint, { values, at: now });
  while (store.held.size > GENERATED_PLANS) {
    const oldest = store.held.keys().next().value!;
    forget(store, oldest, 'evicted');
    // The server's log names the plan, never a value.
    process.stderr.write(
      `configure-env: dropped the generated values held for plan ${oldest}: ${GENERATED_PLANS} newer plans are held\n`,
    );
  }
}

/**
 * Takes the values generated for the plan an apply names, once: whatever
 * the apply answers, they are gone after it. Without them, why: expired,
 * evicted, or unknown (never held by this server).
 */
function takeGenerated(
  project: Project,
  fingerprint: string,
): { values: Record<string, string> } | { gone: Gone | 'unknown' } {
  const store = storeOf(project);
  const entry = store.held.get(fingerprint);
  store.held.delete(fingerprint);
  if (entry && Date.now() - entry.at <= GENERATED_TTL_MS)
    return { values: entry.values };
  if (entry) return { gone: 'expired' };
  return { gone: store.gone.get(fingerprint) ?? 'unknown' };
}

/** What an apply answers when the values its plan showed are gone. */
const goneMessages: Record<Gone | 'unknown', string> = {
  expired: 'the generated values for this plan expired; run apply again',
  evicted: `the generated values for this plan were dropped to make room for ${GENERATED_PLANS} newer plans; run apply again`,
  unknown:
    'this server does not hold the generated values for this plan: it restarted since the plan, or another instance made it; run apply again',
};

/**
 * The state a run settles protected values with: the protected state when
 * the schema protects anything (one that cannot be read refuses the run),
 * else the state read only to forget the fingerprints of pruned keys.
 */
async function runState(
  schema: EnvSchema,
  project: Project,
  prune: boolean,
): Promise<{ run?: RunState; warning?: string }> {
  if (!protectsAny(schema) && !prune) return {};
  const result = await loadState(project.statePath);
  if (result.ok)
    return { run: { path: project.statePath, state: result.state } };
  if (protectsAny(schema))
    throw new ApiError(503, `invalid state ${result.message}`);
  return {
    warning: keptWarning(
      cwdOf(project),
      project.statePath,
      'cannot be read',
      result.message,
      false,
    ),
  };
}

interface Planned {
  plan: Plan;
  view: PlanView;
  run?: RunState;
  warning?: string;
  /** Whether the run made a value for a `generate` key. */
  generated: boolean;
}

interface RunValues {
  values: Record<string, string>;
  errors: PlanError[];
  /** The values generated for this plan, by key. */
  made: Record<string, string>;
  /** Each `generate` key's value, masked. */
  generated?: Record<string, string>;
  /** apply's checks, when the inputs take `defer`. */
  checks?: { defer: string[]; empty: string[] };
}

const unique = (keys: readonly string[] | undefined) => [
  ...new Set(keys ?? []),
];

/**
 * The values a run plans with, and the errors and deferred keys of apply's
 * checks: with `generate` or `defer` only (see contracts.ts). `kept` holds
 * the values generated for the plan an apply names.
 */
async function runValues(
  schema: EnvSchema,
  project: Project,
  inputs: PlanInputs,
  kept: Readonly<Record<string, string>> | undefined,
): Promise<RunValues> {
  const values = inputs.values ?? {};
  const generate = unique(inputs.generate);
  const checks = inputs.defer !== undefined;
  if (!generate.length && !checks) return { values, errors: [], made: {} };
  const defer = unique(inputs.defer);
  checkInputs(schema, values, generate, defer);
  const generateFiles = inputs.generateFiles ?? inputs.files;
  checkGenerated(schema, generateFiles, generate);
  const firstOf = (files: readonly string[] | undefined) =>
    planChanges({
      schema,
      root: project.root,
      values: {},
      ...(files ? { files: [...files] } : {}),
      prune: Boolean(inputs.prune),
    });
  const first = await firstOf(inputs.files);
  // The files a generated key looks at: the picked ones, planned or not.
  const held = inputs.generateFiles ? await firstOf(generateFiles) : first;
  const made: Record<string, string> = {};
  const given = withGenerated(
    schema,
    held.files,
    values,
    generate,
    (key) => {
      made[key] = kept?.[key] ?? generateFor(schema, key);
      return made[key];
    },
    new Set(inputs.prompted ?? []),
  );
  const generated = Object.fromEntries(
    generate
      .filter((key) => given[key] !== undefined)
      .map((key) => [key, maskValue(schema.variables[key]!, given[key]!)]),
  );
  if (!checks) return { values: given, errors: [], made, generated };
  const { errors, empty } = requiredErrors(
    schema,
    neededKeys(schema, first.files),
    given,
    defer,
  );
  return {
    values: given,
    errors,
    made,
    ...(generate.length ? { generated } : {}),
    checks: { defer, empty },
  };
}

/**
 * Plans the run and shows it: POST /api/plan, and the first step of apply.
 * An apply passes the values generated for its plan as `kept`; only a
 * plan without them keeps the values it generates, for its apply.
 */
async function plan(
  read: ReadSchema,
  project: Project,
  inputs: PlanInputs,
  kept?: Readonly<Record<string, string>>,
): Promise<Planned> {
  const { schema } = read;
  const run = await runValues(schema, project, inputs, kept);
  const plan = await planChanges({
    schema,
    root: project.root,
    values: run.values,
    ...(inputs.files ? { files: inputs.files } : {}),
    prune: Boolean(inputs.prune),
  });
  const errors = [...run.errors, ...plan.errors];
  // Like a required value, a broken rule between variables writes nothing.
  if (run.checks && !errors.length)
    errors.push(...ruleErrors(schema, plan.files, run.checks.defer));
  plan.errors = errors;
  const state = await runState(schema, project, Boolean(inputs.prune));
  const replace = new Set(inputs.replaceProtected ?? []);
  // Each check alone, so a refusal names the file it is in.
  const verdicts = state.run
    ? runChecks(schema, plan).checks.map((check) => ({
        check,
        ...verdictsOf(schema, state.run!.state, [check], replace),
      }))
    : [];
  const protectedRefusals = verdicts.flatMap(({ check, refused }) =>
    refused.map(({ key, message, reason }) => ({
      file: check.file.path,
      key,
      message,
      ...(reason ? { reason } : {}),
    })),
  );
  const view: PlanView = {
    fingerprint: planFingerprint(read.fingerprint, plan),
    ok: !plan.errors.length && !protectedRefusals.length,
    files: plan.files.map((file) => ({
      ...viewOf(schema, file),
      ...(run.checks
        ? { deferred: leftIn(schema, file, run.checks.empty) }
        : {}),
    })),
    errors: plan.errors,
    protected: protectedRefusals,
    replaced: verdicts.flatMap(({ replaced }) => replaced),
    ...(run.generated ? { generated: run.generated } : {}),
  };
  const generated = Object.keys(run.made).length > 0;
  if (!kept && generated && inputs.hold !== false)
    keepGenerated(project, view.fingerprint, run.made);
  return { plan, view, ...state, generated };
}

function viewOf(schema: EnvSchema, file: FilePlan): PlanView['files'][number] {
  const skipped = file.action === 'skip';
  return {
    path: file.path,
    policy: file.policy,
    action: file.action,
    ...(file.reason ? { reason: file.reason } : {}),
    ...(file.error ? { error: file.error } : {}),
    addedKeys: file.addedKeys,
    prunedKeys: file.prunedKeys ?? [],
    mode: formatMode(file.mode),
    currentMode:
      file.currentMode === undefined ? null : formatMode(file.currentMode),
    fingerprint: contentFingerprint(file.previous),
    diff:
      skipped || file.reason === 'refused'
        ? []
        : fileDiff(schema, file.previous, file.content ?? file.previous),
  };
}

/** POST /api/plan. */
export async function planProject(
  read: ReadSchema,
  project: Project,
  inputs: PlanInputs,
): Promise<PlanView> {
  return (await plan(read, project, inputs)).view;
}

/** POST /api/apply: the plan shown, written, or why not. */
export async function applyProject(
  read: ReadSchema,
  project: Project,
  inputs: z.output<typeof applyRequest>,
  actor: ChangeActor = 'portal',
): Promise<z.output<typeof applyResponse>> {
  const { schema } = read;
  // Without values kept for its plan, the apply makes new ones, so its
  // fingerprint differs (409); it keeps none of them either way.
  const held = takeGenerated(project, inputs.fingerprint);
  const kept = 'values' in held ? held.values : {};
  const planned = await plan(read, project, inputs, kept);
  const { view } = planned;
  // The values the plan showed are gone: say why.
  if (
    view.fingerprint !== inputs.fingerprint &&
    'gone' in held &&
    planned.generated
  )
    throw new ApiError(409, goneMessages[held.gone], { plan: view });
  if (view.fingerprint !== inputs.fingerprint)
    throw new ApiError(
      409,
      'the plan changed since it was shown; review it and apply again',
      { plan: view },
    );
  if (!view.ok)
    throw new ApiError(
      422,
      view.errors.length
        ? 'the plan has errors; nothing was written'
        : 'the plan changes protected values; nothing was written',
      { plan: view },
    );

  const { checks, files } = runChecks(schema, planned.plan);
  const { plan: toWrite } = planned;
  const guarded = await writeProtected(
    {
      cwd: cwdOf(project),
      ...(project.writeState ? { writeState: project.writeState } : {}),
    },
    schema,
    planned.run,
    {
      checks,
      files,
      replace: new Set(inputs.replaceProtected ?? []),
      forget: toWrite.files.flatMap((file) =>
        (file.prunedKeys ?? []).map((key) => ({ file: file.path, key })),
      ),
      bestEffort: !protectsAny(schema),
    },
    async () => {
      const results = await applyPlan(toWrite);
      const paths = (keep: (file: FilePlan, i: number) => boolean) =>
        toWrite.files.filter(keep).map((file) => file.path);
      return {
        value: results,
        done: paths(
          (file, i) => Boolean(results[i]?.ok) && file.reason !== 'refused',
        ),
        written: paths((_, i) => Boolean(results[i]?.written)),
      };
    },
  );
  if (!guarded.ok) {
    if (guarded.kind === 'state')
      throw new ApiError(503, guarded.lines.join('; '), {
        path: guarded.path,
        lines: guarded.lines,
      });
    // The state changed between the plan and its write transaction.
    throw new ApiError(
      422,
      'the plan changes protected values; nothing was written',
      { plan: (await plan(read, project, inputs, kept)).view },
    );
  }

  const results = guarded.value;
  const warnings = [
    ...(planned.warning &&
    toWrite.files.some(
      (file, i) => file.prunedKeys?.length && results[i]?.written,
    )
      ? [planned.warning]
      : []),
    ...(guarded.warning ? [guarded.warning] : []),
    ...(guarded.stateError ?? []),
  ];
  const history = await recordHistory(
    project.statePath,
    actor,
    appliedChanges(schema, toWrite, results, guarded.replaced),
  );
  // The CLI shows the state's path as it named it.
  const shown = displayPath(cwdOf(project), project.statePath);
  warnings.push(
    ...history.warnings.map((line) =>
      project.cwd === undefined
        ? line
        : line.replaceAll(project.statePath, shown),
    ),
  );
  return {
    ok: results.every((result) => result.ok),
    files: results.map(({ path, action, ok, written, error }) => ({
      path,
      action,
      ok,
      written,
      ...(error ? { error } : {}),
    })),
    replaced: guarded.replaced,
    warnings,
    ...(guarded.stateError
      ? {
          stateError: { path: project.statePath, lines: guarded.stateError },
        }
      : {}),
  };
}
