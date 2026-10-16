import { describe, expect, it } from 'vitest';
import { fullDate, relativeDate } from './dates';

const now = new Date('2026-10-16T12:00:00.000Z');
const before = (seconds: number) => new Date(now.getTime() - seconds * 1000);

describe('relativeDate', () => {
  it('says how long ago, in the largest whole unit', () => {
    expect(relativeDate(before(10), now, 'en')).toBe('now');
    expect(relativeDate(before(5 * 60), now, 'en')).toBe('5 minutes ago');
    expect(relativeDate(before(3 * 60 * 60 + 59), now, 'en')).toBe(
      '3 hours ago',
    );
    expect(relativeDate(before(26 * 60 * 60), now, 'en')).toBe('yesterday');
    expect(relativeDate(before(15 * 24 * 60 * 60), now, 'en')).toBe(
      '2 weeks ago',
    );
    expect(relativeDate(before(400 * 24 * 60 * 60), now, 'en')).toBe(
      'last year',
    );
  });

  it('speaks the language it is given', () => {
    expect(relativeDate(before(5 * 60), now, 'es')).toBe('hace 5 minutos');
    expect(relativeDate(before(26 * 60 * 60), now, 'es')).toBe('ayer');
  });
});

describe('fullDate', () => {
  it('gives the date and time in the language', () => {
    const at = new Date('2026-10-15T14:30:00.000Z');
    expect(fullDate(at, 'en')).toMatch(/Oct 15, 2026/);
    expect(fullDate(at, 'es')).toMatch(/15 oct 2026/);
  });
});
