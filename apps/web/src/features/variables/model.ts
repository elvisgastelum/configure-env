// The variables browser's data: each variable's status in the env files,
// the search and the filters, the sort, and the groups the table shows.

import type {
  FileInfo,
  Variable,
  VariableSpec,
} from '@configure-env/api-client';

/** What may be wrong with a variable's values. */
export type VariableStatus = 'missing' | 'invalid' | 'drift';
export const VARIABLE_STATUSES: readonly VariableStatus[] = [
  'missing',
  'invalid',
  'drift',
];

/** The status filter: one problem, or none at all. */
export type StatusFilter = VariableStatus | 'ok';

export interface Filters {
  query: string;
  type?: VariableSpec['type'];
  /** A group name; null keeps the ungrouped variables. */
  group?: string | null;
  required?: boolean;
  secret?: boolean;
  protected?: boolean;
  /** Only the variables this file lists; the status looks at it alone. */
  file?: string;
  status?: StatusFilter;
}

export const EMPTY_FILTERS: Filters = { query: '' };

export type SortOrder = 'schema' | 'name' | 'name-desc' | 'type' | 'status';
export const SORT_ORDERS: readonly SortOrder[] = [
  'schema',
  'name',
  'name-desc',
  'type',
  'status',
];

export interface Section {
  /** The group heading; null for the variables without a group. */
  group: string | null;
  variables: Variable[];
}

/** Whether a file the schema lists for `variable` would gain it on apply. */
const drifts = (
  variable: Variable,
  files: readonly FileInfo[],
  file?: string,
) =>
  files.some(
    (info) =>
      (file === undefined || info.path === file) &&
      info.drift.missingKeys.includes(variable.name),
  );

/**
 * The problems of `variable`'s values, in every file it is listed in, or
 * only in `file`: a value missing or breaking its rules, or a file that
 * lacks the key (drift).
 */
export function statusesOf(
  variable: Variable,
  files: readonly FileInfo[],
  file?: string,
): VariableStatus[] {
  const values = variable.files.filter(
    (value) => file === undefined || value.file === file,
  );
  const found = new Set<VariableStatus>();
  for (const value of values) {
    if (value.status === 'missing') found.add('missing');
    if (value.status === 'invalid') found.add('invalid');
  }
  if (drifts(variable, files, file)) found.add('drift');
  return VARIABLE_STATUSES.filter((status) => found.has(status));
}

/** Whether `query` appears in the name, the description or the comment. */
export function matchesQuery(variable: Variable, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const { description = '', comment = '' } = variable.spec;
  return [variable.name, description, comment].some((text) =>
    text.toLowerCase().includes(needle),
  );
}

export const isProtected = (spec: VariableSpec) => spec.protected !== undefined;

/** The reason a protected variable gives, if any. */
export const protectedReason = (spec: VariableSpec) =>
  typeof spec.protected === 'object' ? spec.protected.reason : undefined;

function matches(
  variable: Variable,
  files: readonly FileInfo[],
  filters: Filters,
): boolean {
  const { spec } = variable;
  if (!matchesQuery(variable, filters.query)) return false;
  if (filters.type !== undefined && spec.type !== filters.type) return false;
  if (filters.group !== undefined && (spec.group ?? null) !== filters.group)
    return false;
  if (filters.required && !spec.required) return false;
  if (filters.secret && !spec.secret) return false;
  if (filters.protected && !isProtected(spec)) return false;
  if (
    filters.file !== undefined &&
    !variable.files.some((value) => value.file === filters.file)
  )
    return false;
  if (filters.status !== undefined) {
    const statuses = statusesOf(variable, files, filters.file);
    return filters.status === 'ok'
      ? statuses.length === 0
      : statuses.includes(filters.status);
  }
  return true;
}

/** Invalid first, then drift, then missing, then the ones with none. */
function severity(statuses: readonly VariableStatus[]): number {
  if (statuses.includes('invalid')) return 0;
  if (statuses.includes('drift')) return 1;
  if (statuses.includes('missing')) return 2;
  return 3;
}

function sorted(
  list: Variable[],
  files: readonly FileInfo[],
  order: SortOrder,
  file?: string,
): Variable[] {
  const byName = (a: Variable, b: Variable) => a.name.localeCompare(b.name);
  switch (order) {
    case 'schema':
      return list;
    case 'name':
      return list.toSorted(byName);
    case 'name-desc':
      return list.toSorted((a, b) => byName(b, a));
    case 'type':
      return list.toSorted((a, b) => a.spec.type.localeCompare(b.spec.type));
    case 'status':
      return list.toSorted(
        (a, b) =>
          severity(statusesOf(a, files, file)) -
          severity(statusesOf(b, files, file)),
      );
  }
}

/** The variables by group, in schema order; the ungrouped ones last. */
export function sectionsOf(list: readonly Variable[]): Section[] {
  const groups = new Map<string | null, Variable[]>();
  for (const variable of list) {
    const group = variable.spec.group ?? null;
    const members = groups.get(group) ?? [];
    if (!groups.has(group)) groups.set(group, members);
    members.push(variable);
  }
  const ungrouped = groups.get(null);
  groups.delete(null);
  const sections = [...groups].map(([group, variables]) => ({
    group,
    variables,
  }));
  if (ungrouped) sections.push({ group: null, variables: ungrouped });
  return sections;
}

/** What the table shows: the matching variables, grouped then sorted. */
export function browse(
  list: readonly Variable[],
  files: readonly FileInfo[],
  filters: Filters,
  order: SortOrder,
): Section[] {
  const kept = list.filter((variable) => matches(variable, files, filters));
  return sectionsOf(kept).map((section) => ({
    ...section,
    variables: sorted(section.variables, files, order, filters.file),
  }));
}

/** Every group name in schema order. */
export const groupsOf = (list: readonly Variable[]) =>
  sectionsOf(list).flatMap((section) =>
    section.group === null ? [] : [section.group],
  );

/** Whether any variable has no group. */
export const hasUngrouped = (list: readonly Variable[]) =>
  list.some((variable) => variable.spec.group === undefined);

/** Every type the schema uses, sorted. */
export const typesOf = (list: readonly Variable[]) =>
  [...new Set(list.map((variable) => variable.spec.type))].sort();

/** How many filters (besides the search) are set. */
export const activeFilterCount = (filters: Filters) =>
  (['type', 'group', 'file', 'status'] as const).filter(
    (key) => filters[key] !== undefined,
  ).length +
  (['required', 'secret', 'protected'] as const).filter((key) => filters[key])
    .length;

/** The DOM id of a variable's table row. */
export const rowId = (name: string) => `variable-row-${name}`;
