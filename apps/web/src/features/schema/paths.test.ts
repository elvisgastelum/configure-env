import { formatIssuePath } from '@configure-env/core/schema';
import { describe, expect, it } from 'vitest';
import { parseIssuePath } from './paths';

describe('parseIssuePath', () => {
  it.each([
    ['(root)', []],
    ['version', ['version']],
    [
      'variables.API_URL.requiredUnless[0]',
      ['variables', 'API_URL', 'requiredUnless', 0],
    ],
    [
      'variables.DB_PASSWORD.protected.reason',
      ['variables', 'DB_PASSWORD', 'protected', 'reason'],
    ],
    ['files[1].variables[12]', ['files', 1, 'variables', 12]],
    ['files[0].values.PORT', ['files', 0, 'values', 'PORT']],
  ])('reads %s', (path, segments) => {
    expect(parseIssuePath(path)).toEqual(segments);
  });

  it('reads back every path the core formats, quoted keys included', () => {
    for (const segments of [
      ['variables', 'not-a-name', 'type'],
      ['files', 2, 'comments', 'with "quotes" and ]'],
      ['variables', '1ABC'],
      ['$schema'],
    ])
      expect(parseIssuePath(formatIssuePath(segments))).toEqual(segments);
  });

  it('gives undefined for text that is not a path', () => {
    expect(parseIssuePath('files[')).toBeUndefined();
    expect(parseIssuePath('a..b')).toBeUndefined();
  });
});
