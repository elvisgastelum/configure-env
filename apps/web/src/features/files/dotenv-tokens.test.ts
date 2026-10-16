import { describe, expect, it } from 'vitest';
import { tokenize } from './dotenv-tokens';

const kinds = (line: string) =>
  tokenize(line).map(({ kind, text }) => [kind, text]);

describe('tokenize', () => {
  it('splits an entry into its key, operator and value', () => {
    expect(kinds('PORT=8080')).toEqual([
      ['key', 'PORT'],
      ['operator', '='],
      ['value', '8080'],
    ]);
  });

  it('reads a comment line and a trailing comment', () => {
    expect(kinds('  # note')).toEqual([
      ['text', '  '],
      ['comment', '# note'],
    ]);
    expect(kinds('LEVEL=debug # loud')).toEqual([
      ['key', 'LEVEL'],
      ['operator', '='],
      ['value', 'debug'],
      ['text', ' '],
      ['comment', '# loud'],
    ]);
  });

  it('keeps a # inside quotes in the value', () => {
    expect(kinds('export NAME="a # b" # c')).toEqual([
      ['keyword', 'export'],
      ['text', ' '],
      ['key', 'NAME'],
      ['operator', '='],
      ['value', '"a # b"'],
      ['text', ' '],
      ['comment', '# c'],
    ]);
  });

  it('leaves a line that is not an entry as text', () => {
    expect(kinds('not an entry')).toEqual([['text', 'not an entry']]);
    expect(kinds('')).toEqual([]);
  });

  it('keeps every character, in order', () => {
    for (const line of ['A = "x\\" # y" #z', "B='q' trailing", 'C=#hash'])
      expect(
        tokenize(line)
          .map((token) => token.text)
          .join(''),
      ).toBe(line);
  });
});
