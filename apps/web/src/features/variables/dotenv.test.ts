import { describe, expect, it } from 'vite-plus/test';
import { dotenvLine, dotenvOf, quoteValue } from './dotenv';

describe('quoteValue', () => {
  it('keeps a plain value as is', () => {
    expect(quoteValue('8080')).toBe('8080');
    expect(quoteValue('https://api.example.com/v1?x=1')).toBe(
      'https://api.example.com/v1?x=1',
    );
  });

  it('single-quotes a value with a dollar sign, so it is not interpolated', () => {
    expect(quoteValue('pa$$ word')).toBe("'pa$$ word'");
  });

  it('double-quotes and escapes what single quotes cannot hold', () => {
    expect(quoteValue('hello world')).toBe('"hello world"');
    expect(quoteValue("it's $5")).toBe('"it\'s \\$5"');
    expect(quoteValue('two\nlines')).toBe('"two\\nlines"');
    expect(quoteValue('say "hi"')).toBe('"say \\"hi\\""');
  });
});

describe('dotenv', () => {
  it('writes KEY=VALUE lines, export lines and a whole file', () => {
    expect(dotenvLine('PORT', '8080')).toBe('PORT=8080');
    expect(dotenvLine('GREETING', 'hello world', true)).toBe(
      'export GREETING="hello world"',
    );
    expect(
      dotenvOf([
        ['PORT', '8080'],
        ['HOST', 'localhost'],
      ]),
    ).toBe('PORT=8080\nHOST=localhost\n');
    expect(dotenvOf([])).toBe('');
  });
});
