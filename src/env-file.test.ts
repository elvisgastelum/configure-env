import { describe, expect, it } from 'vitest';
import { mergeMissingKeys, parse } from './env-file.ts';
import { EXAMPLE_KEYS } from './template.ts';

describe('parse', () => {
  it('reads KEY=value lines and keeps comments and blanks as raw lines', () => {
    const entries = parse('# note\nA=1\n\nB=two=2\nnot a pair\n');
    expect(entries.map((e) => e.key)).toEqual([
      undefined,
      'A',
      undefined,
      'B',
      undefined,
    ]);
    expect(entries[3]).toEqual({ raw: 'B=two=2', key: 'B', value: 'two=2' });
  });

  it('returns no entries for empty content', () => {
    expect(parse('')).toEqual([]);
  });
});

describe('mergeMissingKeys', () => {
  const custom =
    '# my own comment\nCUSTOM_ONE=1\nWEB_HOST=10.0.0.5\nCUSTOM_TWO=two';

  it('keeps every existing line and appends only the missing keys', () => {
    const { content, added } = mergeMissingKeys(custom, EXAMPLE_KEYS);
    expect(added).toEqual([
      'WEB_PORT',
      'VITE_CONTACT_EMAIL',
      'VITE_CONTACT_WHATSAPP',
    ]);
    expect(
      content.startsWith(
        '# my own comment\nCUSTOM_ONE=1\nWEB_HOST=10.0.0.5\nCUSTOM_TWO=two\n\n# Host port',
      ),
    ).toBe(true);
    const lines = content.split('\n');
    expect(lines.filter((l) => l.startsWith('WEB_HOST='))).toEqual([
      'WEB_HOST=10.0.0.5',
    ]);
    expect(lines.filter((l) => l === 'WEB_PORT=8080')).toHaveLength(1);
    expect(
      lines.filter((l) => l.startsWith('# Contact details embedded')),
    ).toHaveLength(1);
  });

  it('is idempotent', () => {
    const once = mergeMissingKeys(custom, EXAMPLE_KEYS).content;
    const twice = mergeMissingKeys(once, EXAMPLE_KEYS);
    expect(twice.added).toEqual([]);
    expect(twice.content).toBe(once);
  });

  it('adds no blank line to an empty file', () => {
    const { content } = mergeMissingKeys('', ['WEB_PORT']);
    expect(content).toBe(
      '# Host port the site is published on.\nWEB_PORT=8080\n',
    );
  });

  it('separates the block with one blank line after a terminated last line', () => {
    const { content } = mergeMissingKeys('A=1\n', ['WEB_PORT']);
    expect(content).toBe(
      'A=1\n\n# Host port the site is published on.\nWEB_PORT=8080\n',
    );
  });
});
