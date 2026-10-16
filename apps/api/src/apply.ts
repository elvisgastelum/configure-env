// Plan, then apply: POST /api/plan shows what a run would do to each file,
// with masked diffs and a fingerprint, writing nothing; POST /api/apply
// plans again from the same inputs and writes that plan only when its
// fingerprint is still the one shown, so a stale preview is never applied.
// Protected values are settled with the state as `configure-env apply`
// settles them, and every changed key is recorded in the history.

import { createHash } from 'node:crypto';
import {
  type EnvSchema,
  type FilePlan,
  type Plan,
  type ProtectedCheck,
  type RunFile,
  type RunState,
  appliedChanges,
  applyPlan,
  checksOf,
  formatMode,
  getValue,
  loadState,
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
  return { warning: `the protected state cannot be read: ${result.message}` };
}

interface Planned {
  plan: Plan;
  view: PlanView;
  run?: RunState;
  warning?: string;
}

/** Plans the run and shows it: POST /api/plan, and the first step of apply. */
async function plan(
  read: ReadSchema,
  project: Project,
  inputs: PlanInputs,
): Promise<Planned> {
  const { schema } = read;
  const plan = await planChanges({
    schema,
    root: project.root,
    values: inputs.values ?? {},
    ...(inputs.files ? { files: inputs.files } : {}),
    prune: Boolean(inputs.prune),
  });
  const state = await runState(schema, project, Boolean(inputs.prune));
  const replace = new Set(inputs.replaceProtected ?? []);
  // Each check alone, so a refusal names the file it is in.
  const protectedRefusals = state.run
    ? runChecks(schema, plan).checks.flatMap((check) =>
        verdictsOf(schema, state.run!.state, [check], replace).refused.map(
          ({ key, message, reason }) => ({
            file: check.file.path,
            key,
            message,
            ...(reason ? { reason } : {}),
          }),
        ),
      )
    : [];
  const view: PlanView = {
    fingerprint: planFingerprint(read.fingerprint, plan),
    ok: !plan.errors.length && !protectedRefusals.length,
    files: plan.files.map((file) => viewOf(schema, file)),
    errors: plan.errors,
    protected: protectedRefusals,
  };
  return { plan, view, ...state };
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
): Promise<z.output<typeof applyResponse>> {
  const { schema } = read;
  const planned = await plan(read, project, inputs);
  const { view } = planned;
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
    { cwd: project.root },
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
      throw new ApiError(503, guarded.lines.join('; '));
    // The state changed between the plan and its write transaction.
    throw new ApiError(
      422,
      'the plan changes protected values; nothing was written',
      { plan: (await plan(read, project, inputs)).view },
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
    'portal',
    appliedChanges(schema, toWrite, results, guarded.replaced),
  );
  warnings.push(...history.warnings);
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
  };
}
