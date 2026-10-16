// The values a run asks for, as the TUI does (`configure-env apply`): every
// key a file it creates or regenerates holds, and the keys a merge file
// gains, unless the file is a template or sets the key literally.

import type { FileInfo, Plan, Variable } from '@configure-env/api-client';
import type { SchemaDocument } from '@configure-env/core/schema';

/** The keys the plan's files take values for, in schema order. */
export function neededKeys(
  plan: Plan,
  variables: readonly Variable[],
  files: readonly FileInfo[],
  document: SchemaDocument | undefined,
): string[] {
  const needed = new Set<string>();
  for (const file of plan.files) {
    if (file.action === 'skip' || file.action === 'mode') continue;
    if (files.find((info) => info.path === file.path)?.template) continue;
    const literal =
      document?.files.find((spec) => spec.path === file.path)?.values ?? {};
    const listed = variables
      .filter((variable) =>
        variable.files.some((value) => value.file === file.path),
      )
      .map((variable) => variable.name);
    const keys =
      file.policy === 'generate' || file.action === 'create'
        ? listed
        : file.addedKeys.filter((key) => listed.includes(key));
    for (const key of keys) if (literal[key] === undefined) needed.add(key);
  }
  return variables
    .map((variable) => variable.name)
    .filter((name) => needed.has(name));
}

/** The needed variables by `group`, in order of first appearance. */
export function byGroup(variables: readonly Variable[]) {
  const groups = new Map<string | undefined, Variable[]>();
  for (const variable of variables) {
    const { group } = variable.spec;
    groups.set(group, [...(groups.get(group) ?? []), variable]);
  }
  return [...groups];
}

/** A variable's default as the prompt starts with it; empty without one. */
export const initialValue = (variable: Variable) =>
  variable.spec.secret || variable.spec.default === undefined
    ? ''
    : String(variable.spec.default);
