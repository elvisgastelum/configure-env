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
