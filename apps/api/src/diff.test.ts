import { parseSchema } from '@configure-env/core';
import { describe, expect, it } from 'vitest';
import { diffLines, fileDiff, maskedLines } from './diff.ts';

const parsed = parseSchema({
  version: 1,
  variables: {
    NAME: { type: 'string' },
    KEY: { type: 'string', secret: true },
  },
  files: [],
});
if (!parsed.ok) throw new Error('invalid schema');
const { schema } = parsed;

describe('diffLines', () => {
  it('keeps common lines and marks the rest', () => {
    expect(diffLines(['a', 'b', 'c'], ['a', 'x', 'c', 'd'])).toEqual([
      { kind: 'same', line: 'a' },
      { kind: 'removed', line: 'b' },
      { kind: 'added', line: 'x' },
      { kind: 'same', line: 'c' },
      { kind: 'added', line: 'd' },
    ]);
  });

  it('handles empty sides', () => {
    expect(diffLines([], ['a'])).toEqual([{ kind: 'added', line: 'a' }]);
    expect(diffLines(['a'], [])).toEqual([{ kind: 'removed', line: 'a' }]);
  });
});

describe('maskedLines', () => {
  it('masks a secret, keeping its quotes and comment', () => {
    expect(maskedLines(schema, 'NAME=app\nKEY="abcdefghijkl" # set\n')).toEqual(
      ['NAME=app', 'KEY=••••kl # set'],
    );
  });

  it('masks a secret spanning lines as one line', () => {
    const lines = maskedLines(schema, 'KEY="line one\nline two"\nNAME=x\n');
    expect(lines).toEqual(['KEY=••••wo', 'NAME=x']);
    expect(lines.join('\n')).not.toContain('line one');
  });

  it('masks everything after the = of a secret on a line that does not parse or is commented out', () => {
    const value = ['s3cr3t', 'value', 'zz'].join('-');
    const lines = maskedLines(
      schema,
      [
        `KEY="${value}`,
        `KEY="${value}" trailing`,
        `  export KEY = '${value}' more`,
        `NAME="${value}" trailing`,
        `# KEY=${value}`,
        `# NAME=${value}`,
        `## \t# KEY=${value}`,
        '# a comment',
      ].join('\n') + '\n',
    );
    expect(lines).toEqual([
      'KEY=••••',
      'KEY=••••',
      '  export KEY =••••',
      `NAME="${value}" trailing`,
      '# KEY=••••',
      `# NAME=${value}`,
      '## \t# KEY=••••',
      '# a comment',
    ]);
  });

  it('masks a secret on a line that does not parse in a plan diff too', () => {
    const value = ['s3cr3t', 'value', 'zz'].join('-');
    const diff = fileDiff(schema, `KEY="${value}\n`, 'KEY=other\n');
    expect(JSON.stringify(diff)).not.toContain(value);
  });
});

describe('fileDiff', () => {
  it('never shows a secret that changed', () => {
    const diff = fileDiff(
      schema,
      'KEY=old-secret-value\n',
      'KEY=new-secret-value\n',
    );
    expect(JSON.stringify(diff)).not.toMatch(/secret-value/);
    expect(diff).toEqual([
      { kind: 'removed', line: 'KEY=••••ue' },
      { kind: 'added', line: 'KEY=••••ue' },
    ]);
  });
});
