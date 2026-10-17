// Where a JSON path lands in JSON text: the line and column an editor opens
// for a schema error. The paths are the ones formatIssuePath writes
// (`files[1].variables[0]`, `variables["a key"]`), and the text is read with
// a small tokenizer that records where each member starts.

import type { TextPosition } from '../engine/dotenv.ts';

type Segment = string | number;

const SEGMENT =
  /\.?([A-Za-z_$][A-Za-z0-9_$]*)|\[(\d+)\]|\[("(?:[^"\\]|\\.)*")\]/y;

/** A path like `files[1].variables[0]` as its segments; undefined when it is not one. */
export function parseIssuePath(path: string): Segment[] | undefined {
  if (path === '(root)') return [];
  const segments: Segment[] = [];
  let at = 0;
  while (at < path.length) {
    SEGMENT.lastIndex = at;
    const match = SEGMENT.exec(path);
    // A dot only separates names: never first, never before a bracket.
    if (!match || (at === 0 && path[0] === '.')) return undefined;
    if (match[1] !== undefined) segments.push(match[1]);
    else if (match[2] !== undefined) segments.push(Number(match[2]));
    else {
      try {
        segments.push(JSON.parse(match[3]!) as string);
      } catch {
        return undefined;
      }
    }
    at = SEGMENT.lastIndex;
  }
  return segments;
}

/** A value in the text: where it starts, and its members or elements. */
interface Node {
  start: number;
  /** An object's members by key, the last one when a key repeats. */
  members?: Map<string, { keyStart: number; value: Node }>;
  items?: Node[];
}

const SPACE = /[ \t\n\r]*/y;
// No raw control character inside a string.
// oxlint-disable-next-line no-control-regex
const STRING = /"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/y;
const SCALAR =
  /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|true|false|null/y;

class NotJson extends Error {}

/** Parses JSON text into nodes with their offsets; throws NotJson when it is not JSON. */
function parse(text: string): Node {
  let at = 0;
  const skip = () => {
    SPACE.lastIndex = at;
    SPACE.exec(text);
    at = SPACE.lastIndex;
  };
  const token = (pattern: RegExp) => {
    pattern.lastIndex = at;
    const match = pattern.exec(text);
    if (!match) throw new NotJson();
    at = pattern.lastIndex;
    return match[0];
  };
  const expect = (char: string) => {
    skip();
    if (text[at] !== char) throw new NotJson();
    at++;
  };
  const value = (depth: number): Node => {
    // The schema is shallow; a pathological nesting is not worth a map.
    if (depth > 512) throw new NotJson();
    skip();
    const start = at;
    const char = text[at];
    if (char === '{') {
      at++;
      const members: NonNullable<Node['members']> = new Map();
      skip();
      if (text[at] === '}') {
        at++;
        return { start, members };
      }
      for (;;) {
        skip();
        const keyStart = at;
        const key = JSON.parse(token(STRING)) as string;
        expect(':');
        members.set(key, { keyStart, value: value(depth + 1) });
        skip();
        if (text[at] === ',') at++;
        else break;
      }
      expect('}');
      return { start, members };
    }
    if (char === '[') {
      at++;
      const items: Node[] = [];
      skip();
      if (text[at] === ']') {
        at++;
        return { start, items };
      }
      for (;;) {
        items.push(value(depth + 1));
        skip();
        if (text[at] === ',') at++;
        else break;
      }
      expect(']');
      return { start, items };
    }
    token(char === '"' ? STRING : SCALAR);
    return { start };
  };
  const root = value(0);
  skip();
  if (at !== text.length) throw new NotJson();
  return root;
}

/** The 1-based line and column of a character offset. */
function positionOf(text: string, offset: number): TextPosition {
  const before = text.slice(0, offset).split('\n');
  return { line: before.length, column: before.at(-1)!.length + 1 };
}

/**
 * Where `path` is in JSON `text`: the key of an object member, the start of
 * an array element, the start of the value for `(root)`. A path the text
 * does not hold all of lands on its deepest member that it does. Undefined
 * when the text is not JSON or the path cannot be read.
 */
export function jsonPathPosition(
  text: string,
  path: string,
): TextPosition | undefined {
  const segments = parseIssuePath(path);
  if (!segments) return undefined;
  // Editors do not count the byte order mark as a column.
  const json = text.replace(/^\uFEFF/, '');
  let node: Node;
  try {
    node = parse(json);
  } catch (error) {
    if (error instanceof NotJson || error instanceof SyntaxError)
      return undefined;
    throw error;
  }
  let offset = node.start;
  for (const segment of segments) {
    if (typeof segment === 'number') {
      const item = node.items?.[segment];
      if (!item) break;
      node = item;
      offset = item.start;
    } else {
      const member = node.members?.get(segment);
      if (!member) break;
      node = member.value;
      offset = member.keyStart;
    }
  }
  return positionOf(json, offset);
}
