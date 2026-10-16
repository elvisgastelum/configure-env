// A lossless env file model: every line keeps its exact text and line ending,
// so an unmodified document serializes back byte for byte, and an edit
// touches only the lines it changes.
//
// The syntax is the one Docker Compose and dotenv share: `KEY=value`, an
// optional `export ` prefix, single quotes (literal), double quotes (with
// backslash escapes) and unquoted values, where `#` starts an inline comment
// only after whitespace. A quoted value may span lines.

import { unquoteValue } from '../schema/values.ts';

export type LineKind = 'blank' | 'comment' | 'entry' | 'invalid';
export type Eol = '\n' | '\r\n';

/** One logical line; `key` and the value fields are set for entries. */
export interface DotenvLine {
  kind: LineKind;
  /** The exact text, without the line ending; a multiline value keeps its inner breaks. */
  raw: string;
  /** The line ending after `raw`: empty for an unterminated last line. */
  eol: Eol | '';
  key?: string;
  /** The value as a reader sees it: unquoted and unescaped. */
  value?: string;
  /** The quote around the value: `"`, `'`, or empty when unquoted. */
  quote?: '"' | "'" | '';
  exported?: boolean;
  /** Where the written value (quotes included) starts and ends in `raw`. */
  valueStart?: number;
  valueEnd?: number;
}

export interface DotenvDocument {
  lines: DotenvLine[];
  /** The line ending for new lines: the file's majority, LF for new files. */
  eol: Eol;
  /** Whether the file starts with a UTF-8 byte order mark. */
  bom: boolean;
  /** Whether the last line ends in a line ending (true for an empty file). */
  readonly finalNewline: boolean;
}

const ENTRY =
  /^(\s*)(export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)([ \t]*)=([ \t]*)(.*)$/s;
const AFTER_QUOTE = /^[ \t]*(#.*)?$/s;

type Parsed =
  | { kind: 'entry'; line: Omit<DotenvLine, 'raw' | 'eol'> }
  | { kind: 'open' }
  | { kind: 'other'; line: Pick<DotenvLine, 'kind'> };

/** The index of the quote closing the one at `start`, or -1. */
function closingQuote(text: string, start: number): number {
  const quote = text[start];
  for (let i = start + 1; i < text.length; i++) {
    if (quote === '"' && text[i] === '\\') i++;
    else if (text[i] === quote) return i;
  }
  return -1;
}

/** Classifies one logical line's text. */
function parseText(raw: string): Parsed {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: 'other', line: { kind: 'blank' } };
  if (trimmed.startsWith('#'))
    return { kind: 'other', line: { kind: 'comment' } };
  const match = ENTRY.exec(raw);
  if (!match) return { kind: 'other', line: { kind: 'invalid' } };
  const [, indent = '', exported, key = '', gap = '', space = '', rest = ''] =
    match;
  const valueStart =
    indent.length +
    (exported?.length ?? 0) +
    key.length +
    gap.length +
    1 +
    space.length;
  const entry = { kind: 'entry' as const, key, exported: Boolean(exported) };

  const first = rest[0];
  if (first === '"' || first === "'") {
    const close = closingQuote(rest, 0);
    if (close < 0) return { kind: 'open' };
    if (!AFTER_QUOTE.test(rest.slice(close + 1)))
      return { kind: 'other', line: { kind: 'invalid' } };
    const written = rest.slice(0, close + 1);
    return {
      kind: 'entry',
      line: {
        ...entry,
        quote: first,
        value: first === '"' ? unquoteValue(written) : written.slice(1, -1),
        valueStart,
        valueEnd: valueStart + written.length,
      },
    };
  }

  // Unquoted: an inline comment starts at a `#` after whitespace.
  let end = rest.length;
  for (let i = 1; i < rest.length; i++) {
    if (rest[i] === '#' && /\s/.test(rest[i - 1] ?? '')) {
      end = i;
      break;
    }
  }
  if (space && rest.startsWith('#')) end = 0;
  const value = rest.slice(0, end).trimEnd();
  return {
    kind: 'entry',
    line: {
      ...entry,
      quote: '',
      value,
      valueStart,
      valueEnd: valueStart + value.length,
    },
  };
}

/** A logical line from its text; an unclosed quote makes it invalid. */
function makeLine(raw: string, eol: DotenvLine['eol']): DotenvLine {
  const parsed = parseText(raw);
  if (parsed.kind === 'open') return { kind: 'invalid', raw, eol };
  return { ...parsed.line, raw, eol } as DotenvLine;
}

/** Splits text into physical lines, each with its own line ending. */
function physicalLines(text: string): { raw: string; eol: Eol | '' }[] {
  const out: { raw: string; eol: Eol | '' }[] = [];
  let at = 0;
  while (at < text.length) {
    const newline = text.indexOf('\n', at);
    if (newline < 0) {
      out.push({ raw: text.slice(at), eol: '' });
      break;
    }
    const line = text.slice(at, newline);
    out.push(
      line.endsWith('\r')
        ? { raw: line.slice(0, -1), eol: '\r\n' }
        : { raw: line, eol: '\n' },
    );
    at = newline + 1;
  }
  return out;
}

function document(lines: DotenvLine[], eol: Eol, bom: boolean) {
  return {
    lines,
    eol,
    bom,
    get finalNewline() {
      return this.lines.at(-1)?.eol !== '';
    },
  };
}

/** Parses env file text into a document that serializes back unchanged. */
export function parseDotenv(text: string): DotenvDocument {
  const bom = text.startsWith('﻿');
  const physical = physicalLines(bom ? text.slice(1) : text);
  const crlf = physical.filter((line) => line.eol === '\r\n').length;
  const lf = physical.filter((line) => line.eol === '\n').length;

  const lines: DotenvLine[] = [];
  for (let i = 0; i < physical.length; i++) {
    const { raw, eol } = physical[i]!;
    if (parseText(raw).kind !== 'open') {
      lines.push(makeLine(raw, eol));
      continue;
    }
    // An open quote: join the following lines until one closes it.
    let joined = raw;
    let lastEol = eol;
    let closed = -1;
    for (let j = i + 1; j < physical.length && lastEol; j++) {
      joined += lastEol + physical[j]!.raw;
      lastEol = physical[j]!.eol;
      if (parseText(joined).kind !== 'open') {
        closed = j;
        break;
      }
    }
    const line = closed < 0 ? undefined : makeLine(joined, lastEol);
    // A quote that is never closed, or closed only by a quote on a later
    // entry, makes this one line invalid; the next line parses on its own.
    if (!line || line.kind === 'invalid') {
      lines.push({ kind: 'invalid', raw, eol });
      continue;
    }
    lines.push(line);
    i = closed;
  }
  return document(lines, crlf > lf ? '\r\n' : '\n', bom);
}

/** The document as text: byte-identical to the parsed text when unmodified. */
export function serialize(doc: DotenvDocument): string {
  const body = doc.lines.map((line) => line.raw + line.eol).join('');
  return (doc.bom ? '﻿' : '') + body;
}

/** The 1-based physical line numbers of the lines that are not valid entries. */
export function invalidLineNumbers(doc: DotenvDocument): number[] {
  const numbers: number[] = [];
  let number = 1;
  for (const line of doc.lines) {
    if (line.kind === 'invalid') numbers.push(number);
    number += line.raw.split('\n').length;
  }
  return numbers;
}

const entriesOf = (doc: DotenvDocument, key: string) =>
  doc.lines.filter((line) => line.kind === 'entry' && line.key === key);

/** The value of `key`, the last one when it repeats; undefined when absent. */
export function getValue(doc: DotenvDocument, key: string): string | undefined {
  return entriesOf(doc, key).at(-1)?.value;
}

/** A 1-based line and column in a file. */
export interface TextPosition {
  line: number;
  column: number;
}

const ENTRY_PREFIX = /^\s*(?:export[ \t]+)?/;

/**
 * Where `key` is set: the 1-based physical line and column of the key in its
 * last entry, the one getValue reads; undefined when the file does not set it.
 */
export function entryPosition(
  doc: DotenvDocument,
  key: string,
): TextPosition | undefined {
  let found: TextPosition | undefined;
  let number = 1;
  for (const line of doc.lines) {
    if (line.kind === 'entry' && line.key === key)
      found = {
        line: number,
        column: ENTRY_PREFIX.exec(line.raw)![0].length + 1,
      };
    number += line.raw.split('\n').length;
  }
  return found;
}

/** The keys of the document's entries, each once, in first-seen order. */
export function keysOf(doc: DotenvDocument): string[] {
  return [
    ...new Set(
      doc.lines.flatMap((line) => (line.kind === 'entry' ? [line.key!] : [])),
    ),
  ];
}

/** Appends lines (text without line endings) in the document's line ending. */
export function appendLines(doc: DotenvDocument, raws: readonly string[]) {
  if (!raws.length) return;
  const last = doc.lines.at(-1);
  if (last && !last.eol) last.eol = doc.eol;
  for (const raw of raws) doc.lines.push(makeLine(raw, doc.eol));
}

/**
 * Sets `key` to `written`, the value as it goes after `=` (quoted if need
 * be, see formatValue). Each existing entry keeps its indent, export prefix,
 * spacing and inline comment; a missing key is appended.
 */
export function setValue(doc: DotenvDocument, key: string, written: string) {
  const entries = entriesOf(doc, key);
  if (!entries.length) {
    appendLines(doc, [`${key}=${written}`]);
    return;
  }
  for (const line of entries) {
    const raw =
      line.raw.slice(0, line.valueStart) +
      written +
      line.raw.slice(line.valueEnd);
    const index = doc.lines.indexOf(line);
    doc.lines[index] = makeLine(raw, line.eol);
  }
}

/** Removes every entry for `key`; true when there was one. */
export function removeKey(doc: DotenvDocument, key: string): boolean {
  const before = doc.lines.length;
  doc.lines = doc.lines.filter(
    (line) => !(line.kind === 'entry' && line.key === key),
  );
  return doc.lines.length !== before;
}

/** Whether a blank line between the entries `above` and `below` stays. */
export type Separates = (above: string, below: string) => boolean;

/**
 * Removes lines `start` to `end` (a block: an entry and its comment), and
 * the blank line that set it apart, so no blank line is left doubled,
 * leading or trailing: the one above, unless the next line starts a block
 * (a comment), the one above follows a comment (a header), or `separates`
 * the entries around it; else at the start, the one below.
 */
function dropBlock(
  doc: DotenvDocument,
  start: number,
  end: number,
  separates: Separates,
) {
  doc.lines.splice(start, end - start + 1);
  const blank = (index: number) => doc.lines[index]?.kind === 'blank';
  const next = doc.lines[start];
  if (start === 0) {
    if (blank(0)) doc.lines.splice(0, 1);
    return;
  }
  if (!blank(start - 1)) return;
  const above = doc.lines[start - 2];
  const drop =
    !next ||
    next.kind === 'blank' ||
    (next.kind === 'entry' &&
      above?.kind === 'entry' &&
      !separates(above.key!, next.key!));
  if (drop) doc.lines.splice(start - 1, 1);
}

/**
 * Removes every entry for `key`, each with its directly attached comment
 * block (the comment lines right above it) when that block is exactly
 * `comment`, as lines without line endings, or with any such block for
 * `'any'`; any other comment stays. The blank line that set the removed
 * lines apart goes too (see dropBlock). True when there was an entry.
 */
export function removeEntry(
  doc: DotenvDocument,
  key: string,
  comment: readonly string[] | 'any' = [],
  separates: Separates = () => false,
): boolean {
  const isComment = (index: number) => doc.lines[index]?.kind === 'comment';
  let found = false;
  for (;;) {
    const index = doc.lines.findIndex(
      (line) => line.kind === 'entry' && line.key === key,
    );
    if (index < 0) return found;
    found = true;
    let start = index;
    if (comment === 'any') while (isComment(start - 1)) start--;
    else {
      const top = index - comment.length;
      const attached =
        comment.length > 0 &&
        top >= 0 &&
        !isComment(top - 1) &&
        comment.every(
          (raw, i) => isComment(top + i) && doc.lines[top + i]!.raw === raw,
        );
      if (attached) start = top;
    }
    dropBlock(doc, start, index, separates);
  }
}
