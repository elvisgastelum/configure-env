// The History page's filters, kept in the address: `?file=&key=&actor=&from=
// &to=&page=`, so a link (from the variable drawer, say) opens it filtered.

export type HistoryActor = 'cli' | 'portal';

export interface HistorySearch {
  file?: string;
  key?: string;
  actor?: HistoryActor;
  /** A date, YYYY-MM-DD. */
  from?: string;
  to?: string;
  page?: number;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The filters an address holds; anything else is dropped. */
export function validateHistorySearch(
  search: Record<string, unknown>,
): HistorySearch {
  const text = (value: unknown) =>
    typeof value === 'string' && value !== '' ? value : undefined;
  const date = (value: unknown) => {
    const day = text(value);
    return day && DATE.test(day) ? day : undefined;
  };
  const page = Number(search.page);
  const result: HistorySearch = {
    file: text(search.file),
    key: text(search.key),
    actor:
      search.actor === 'cli' || search.actor === 'portal'
        ? search.actor
        : undefined,
    from: date(search.from),
    to: date(search.to),
    page: Number.isInteger(page) && page > 1 ? page : undefined,
  };
  return Object.fromEntries(
    Object.entries(result).filter(([, value]) => value !== undefined),
  ) as HistorySearch;
}
