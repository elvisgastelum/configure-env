// A file's validate problems as the page groups them: by the variable each
// is about (a rule between variables under the first it names), then the
// lines that do not parse, then anything else about the file.

import type { Problem } from '@configure-env/api-client';

export interface VariableProblems {
  name: string;
  problems: Problem[];
}

export interface ProblemGroups {
  variables: VariableProblems[];
  lines: Problem[];
  other: Problem[];
}

export function groupProblems(problems: readonly Problem[]): ProblemGroups {
  const byName = new Map<string, Problem[]>();
  const lines: Problem[] = [];
  const other: Problem[] = [];
  for (const problem of problems) {
    const name = problem.key ?? problem.keys?.[0];
    if (name) byName.set(name, [...(byName.get(name) ?? []), problem]);
    else if (problem.line !== undefined) lines.push(problem);
    else other.push(problem);
  }
  return {
    variables: [...byName].map(([name, list]) => ({ name, problems: list })),
    lines,
    other,
  };
}

/** The other variables a rule problem names besides `name`. */
export const othersOf = (problem: Problem, name: string) =>
  (problem.keys ?? []).filter((key) => key !== name);
