import { describe, expect, it } from 'vitest';
import {
  appendLines,
  getValue,
  parseDotenv,
  removeKey,
  serialize,
  setValue,
} from './dotenv.ts';

// Env file texts the parser must give back byte for byte.
const CORPUS: Record<string, string> = {
  empty: '',
  'one entry': 'A=1\n',
  'no trailing newline': 'A=1\nB=2',
  crlf: '# head\r\nA=1\r\n\r\nB="two words"\r\n',
  'mixed line endings': 'A=1\r\nB=2\nC=3\r\n',
  bom: '\uFEFFA=1\nB=2\n',
  export: 'export A=1\nexport   B="x y"\n',
  quotes: `S='single $HOME'\nD="double \\"q\\" \\n"\nE=""\nF=''\n`,
  'inline comments': 'A=value # a note\nB="quoted # not a note" # a note\n',
  'hash inside values': 'A=a#b\nB="#x"\nC=\'#y\'\n',
  'comments and blanks': '# one\n  # indented\n\n\t\nA=1\n',
  'spaces around equals': 'A = 1\n  B=2  \n',
  invalid: 'not a pair\n=nokey\n1A=bad\nA="unterminated\n',
  'multiline quoted': 'A="line one\nline two"\nB=2\n',
  'blank only': '\n\n',
};

describe('parseDotenv and serialize', () => {
  it.each(Object.entries(CORPUS))('round-trips %s byte for byte', (_, text) => {
    expect(serialize(parseDotenv(text))).toBe(text);
  });

  it('reads entries, comments, blanks and invalid lines', () => {
    const doc = parseDotenv(
      '# c\n\nexport A=1\nB = "x # y" # note\nC=plain # note\nbad line\n',
    );
    expect(doc.lines.map((line) => line.kind)).toEqual([
      'comment',
      'blank',
      'entry',
      'entry',
      'entry',
      'invalid',
    ]);
    expect(doc.lines[2]).toMatchObject({
      key: 'A',
      value: '1',
      quote: '',
      exported: true,
    });
    expect(doc.lines[3]).toMatchObject({
      key: 'B',
      value: 'x # y',
      quote: '"',
      exported: false,
    });
    expect(doc.lines[4]).toMatchObject({ key: 'C', value: 'plain' });
  });

  it('unescapes double quotes, keeps single quotes literal', () => {
    const doc = parseDotenv(`D="a\\nb \\"c\\""\nS='a\\nb $X'\n`);
    expect(getValue(doc, 'D')).toBe('a\nb "c"');
    expect(getValue(doc, 'S')).toBe('a\\nb $X');
  });

  it('keeps a # without whitespace before it in an unquoted value', () => {
    expect(getValue(parseDotenv('A=a#b\n'), 'A')).toBe('a#b');
    expect(getValue(parseDotenv('A= # note\n'), 'A')).toBe('');
  });

  it('reads a quoted value spanning lines as one entry', () => {
    const doc = parseDotenv('A="one\ntwo"\nB=2\n');
    expect(doc.lines).toHaveLength(2);
    expect(getValue(doc, 'A')).toBe('one\ntwo');
  });

  it('takes the line ending of the majority, LF for new files', () => {
    expect(parseDotenv('A=1\r\nB=2\r\nC=3\n').eol).toBe('\r\n');
    expect(parseDotenv('A=1\nB=2\r\n').eol).toBe('\n');
    expect(parseDotenv('').eol).toBe('\n');
  });

  it('notes a BOM and a missing final newline', () => {
    const doc = parseDotenv('\uFEFFA=1');
    expect(doc.bom).toBe(true);
    expect(doc.finalNewline).toBe(false);
    expect(getValue(doc, 'A')).toBe('1');
  });

  it('reads the last of repeated keys', () => {
    expect(getValue(parseDotenv('A=1\nA=2\n'), 'A')).toBe('2');
    expect(getValue(parseDotenv('A=1\n'), 'B')).toBeUndefined();
  });
});

describe('setValue', () => {
  it('replaces the value in place, keeping export and the inline comment', () => {
    const doc = parseDotenv('# top\nexport  A=old # keep me\r\nB=2\r\n');
    setValue(doc, 'A', '"new value"');
    expect(serialize(doc)).toBe(
      '# top\nexport  A="new value" # keep me\r\nB=2\r\n',
    );
    expect(getValue(doc, 'A')).toBe('new value');
  });

  it('keeps the spacing around = and other lines untouched', () => {
    const doc = parseDotenv('X = 1\nA = q\nY=  2  \n');
    setValue(doc, 'A', 'r');
    expect(serialize(doc)).toBe('X = 1\nA = r\nY=  2  \n');
  });

  it('replaces a quoted value whole', () => {
    const doc = parseDotenv(`A='a b' # c\n`);
    setValue(doc, 'A', 'z');
    expect(serialize(doc)).toBe('A=z # c\n');
  });

  it('appends a missing key in the file line ending, ending the last line first', () => {
    const doc = parseDotenv('A=1\r\nB=2');
    setValue(doc, 'C', '3');
    expect(serialize(doc)).toBe('A=1\r\nB=2\r\nC=3\r\n');
  });

  it('sets every occurrence of a repeated key', () => {
    const doc = parseDotenv('A=1\nA=2\n');
    setValue(doc, 'A', '3');
    expect(serialize(doc)).toBe('A=3\nA=3\n');
  });

  it('keeps the BOM', () => {
    const doc = parseDotenv('\uFEFFA=1\n');
    setValue(doc, 'A', '2');
    expect(serialize(doc)).toBe('\uFEFFA=2\n');
  });
});

describe('removeKey', () => {
  it('removes the entry lines and keeps everything else', () => {
    const doc = parseDotenv('# a\nA=1\n\nB=2\r\nA=3\nC=4');
    expect(removeKey(doc, 'A')).toBe(true);
    expect(serialize(doc)).toBe('# a\n\nB=2\r\nC=4');
    expect(removeKey(doc, 'A')).toBe(false);
  });

  it('keeps the other line endings when the last line goes', () => {
    const doc = parseDotenv('A=1\nB=2');
    removeKey(doc, 'B');
    expect(serialize(doc)).toBe('A=1\n');
    removeKey(doc, 'A');
    expect(serialize(doc)).toBe('');
  });
});

describe('appendLines', () => {
  it('ends the last line, then appends in the file line ending', () => {
    const doc = parseDotenv('A=1\r\nB=2');
    appendLines(doc, ['', '# c', 'C=3']);
    expect(serialize(doc)).toBe('A=1\r\nB=2\r\n\r\n# c\r\nC=3\r\n');
    expect(getValue(doc, 'C')).toBe('3');
  });

  it('writes LF into an empty document', () => {
    const doc = parseDotenv('');
    appendLines(doc, ['A=1']);
    expect(serialize(doc)).toBe('A=1\n');
  });
});
