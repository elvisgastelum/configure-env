/** `?focus=<name>`: the variable or file the palette jumped to. */
export interface FocusSearch {
  focus?: string;
}

export function validateFocusSearch(
  search: Record<string, unknown>,
): FocusSearch {
  return typeof search.focus === 'string' && search.focus !== ''
    ? { focus: search.focus }
    : {};
}

/** `/variables`: the palette's focus, and `?group=` from the groups page. */
export interface VariablesSearch extends FocusSearch {
  /** A group name to filter to; null keeps the ungrouped variables. */
  group?: string | null;
}

export function validateVariablesSearch(
  search: Record<string, unknown>,
): VariablesSearch {
  const { group } = search;
  return {
    ...validateFocusSearch(search),
    ...((typeof group === 'string' && group !== '') || group === null
      ? { group }
      : {}),
  };
}
