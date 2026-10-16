// Dates as the portal says them, in its language: "5 minutes ago" or
// "hace 5 minutos", with the full date and time for a title.

// In seconds. A month of 30 days and a year of 365 are approximations on
// purpose: a relative date is a rough age, and the full date is in the title.
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 60 * 60],
  ['month', 30 * 24 * 60 * 60],
  ['week', 7 * 24 * 60 * 60],
  ['day', 24 * 60 * 60],
  ['hour', 60 * 60],
  ['minute', 60],
];

/** How long before (or after) `now` the date `at` is, in the largest whole unit. */
export function relativeDate(at: Date, now: Date, language: string): string {
  const format = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
  const seconds = Math.round((at.getTime() - now.getTime()) / 1000);
  for (const [unit, size] of UNITS)
    if (Math.abs(seconds) >= size)
      return format.format(Math.trunc(seconds / size), unit);
  return format.format(0, 'second');
}

/** The date and time in full, like "Oct 15, 2026, 2:30 PM". */
export function fullDate(at: Date, language: string): string {
  return new Intl.DateTimeFormat(language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(at);
}
