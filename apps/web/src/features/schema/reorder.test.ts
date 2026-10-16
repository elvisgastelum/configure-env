import { describe, expect, it } from 'vitest';
import { moveItem } from './reorder';

describe('moveItem', () => {
  const list = ['a', 'b', 'c'];

  it.each([
    [0, 2, ['b', 'c', 'a']],
    [2, 0, ['c', 'a', 'b']],
    [1, 1, ['a', 'b', 'c']],
  ])('moves the item at %i to %i', (from, to, expected) => {
    expect(moveItem(list, from, to)).toEqual(expected);
  });

  it.each([
    [3, 0],
    [-1, 0],
    [0, 3],
    [0, -1],
  ])('gives an unchanged copy for %i to %i, out of range', (from, to) => {
    const moved = moveItem(list, from, to);
    expect(moved).toEqual(list);
    expect(moved).not.toBe(list);
  });
});
