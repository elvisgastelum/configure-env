// Writes a JSON value back over the text it was read from, changing as few
// bytes as it can: a subtree that did not change keeps its original text, a
// container written on one line stays on one line, and the indentation unit,
// line endings, byte order mark and trailing newline of the previous text
// are kept. Without previous text it writes what `JSON.stringify(value,
// null, 2)` does, plus a trailing newline.

/** A JSON value in the previous text, with where it was written. */
interface Node {
  start: number;
  end: number;
  value: unknown;
  /** Whether it was written on a single line. */
  inline: boolean;
  entries?: [string, Node][];
  items?: Node[];
}

const LITERAL = /^(?:true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/;

/** Parses JSON text into nodes that remember their offsets. */
function parseNodes(text: string): Node {
  let at = 0;
  const fail = (): never => {
    throw new SyntaxError(`unexpected input at ${at}`);
  };
  const space = () => {
    while (at < text.length && ' \t\r\n'.includes(text[at] as string)) at++;
  };
  const expect = (char: string) => {
    if (text[at] !== char) fail();
    at++;
  };
  const string = (): string => {
    const start = at;
    expect('"');
    while (at < text.length && text[at] !== '"')
      at += text[at] === '\\' ? 2 : 1;
    expect('"');
    return JSON.parse(text.slice(start, at)) as string;
  };
  const node = (
    start: number,
    value: unknown,
    rest: Pick<Node, 'entries' | 'items'> = {},
  ): Node => ({
    start,
    end: at,
    value,
    inline: !text.slice(start, at).includes('\n'),
    ...rest,
  });
  const value = (): Node => {
    space();
    const start = at;
    const char = text[at];
    if (char === '{') {
      at++;
      const entries: [string, Node][] = [];
      space();
      if (text[at] !== '}') {
        for (;;) {
          space();
          const key = string();
          space();
          expect(':');
          entries.push([key, value()]);
          space();
          if (text[at] !== ',') break;
          at++;
        }
      }
      expect('}');
      const object: Record<string, unknown> = {};
      for (const [key, child] of entries) object[key] = child.value;
      return node(start, object, { entries });
    }
    if (char === '[') {
      at++;
      const items: Node[] = [];
      space();
      if (text[at] !== ']') {
        for (;;) {
          items.push(value());
          space();
          if (text[at] !== ',') break;
          at++;
        }
      }
      expect(']');
      return node(
        start,
        items.map((item) => item.value),
        { items },
      );
    }
    if (char === '"') return node(start, string());
    const literal = LITERAL.exec(text.slice(at));
    if (!literal) return fail();
    at += literal[0].length;
    return node(start, JSON.parse(literal[0]));
  };
  if (text.startsWith('﻿')) at = 1;
  const root = value();
  space();
  if (at !== text.length) fail();
  return root;
}

/** Deep equality of JSON values where the order of object keys counts. */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = Object.entries(a);
  const right = Object.entries(b);
  return (
    left.length === right.length &&
    left.every(([key, value], index) => {
      const other = right[index];
      return other?.[0] === key && sameJson(value, other[1]);
    })
  );
}

/** Parses `previous`, or undefined when it is not JSON. */
function previousNodes(previous: string | undefined): Node | undefined {
  if (previous === undefined) return undefined;
  try {
    return parseNodes(previous);
  } catch {
    return undefined;
  }
}

/** The value as JSON text, reusing what it can of `previous`. */
export function formatJson(value: unknown, previous?: string): string {
  const root = previousNodes(previous);
  const text = root ? (previous ?? '') : '';
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const unit = /\n([ \t]+)\S/.exec(text)?.[1] ?? '  ';

  const emit = (
    current: unknown,
    node: Node | undefined,
    depth: number,
    inline: boolean,
  ): string => {
    if (node && sameJson(node.value, current))
      return text.slice(node.start, node.end);
    if (typeof current !== 'object' || current === null)
      return JSON.stringify(current);
    // A container keeps the shape it was written in; a new one takes its
    // parent's.
    const oneLine = node ? node.inline : inline;
    const used = new Set<Node>();
    const take = (found: Node | undefined) => {
      if (found) used.add(found);
      return found;
    };
    const free = (n: Node | undefined) => (n && !used.has(n) ? n : undefined);
    let parts: string[];
    const isArray = Array.isArray(current);
    if (isArray) {
      const items = node?.items ?? [];
      parts = (current as unknown[]).map((item, index) => {
        // An equal item keeps its text wherever it moved.
        const match =
          items.find((n) => free(n) && sameJson(n.value, item)) ??
          free(items[index]);
        return emit(item, take(match), depth + 1, oneLine);
      });
    } else {
      const entries = node?.entries ?? [];
      parts = Object.entries(current).map(([key, child]) => {
        // A renamed key keeps the text of its unchanged value.
        const match =
          entries.find(([k, n]) => k === key && free(n))?.[1] ??
          entries.find(([, n]) => free(n) && sameJson(n.value, child))?.[1];
        return `${JSON.stringify(key)}: ${emit(child, take(match), depth + 1, oneLine)}`;
      });
    }
    const [open, close] = isArray ? ['[', ']'] : ['{', '}'];
    if (!parts.length) return open + close;
    if (oneLine)
      return isArray ? `[${parts.join(', ')}]` : `{ ${parts.join(', ')} }`;
    const inner = unit.repeat(depth + 1);
    const lines = parts.map((part) => inner + part).join(`,${eol}`);
    return `${open}${eol}${lines}${eol}${unit.repeat(depth)}${close}`;
  };

  // What JSON.stringify would write: no undefined fields, no functions.
  const json = JSON.parse(JSON.stringify(value) ?? 'null') as unknown;
  const body = emit(json, root, 0, false);
  if (!root) return `${body}\n`;
  return text.slice(0, root.start) + body + text.slice(root.end);
}
