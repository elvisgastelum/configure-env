// Syntax highlighting for the raw view of an env file: each line split into
// tokens that keep every character, so the line reads exactly as written.

export type TokenKind =
  | 'comment'
  | 'keyword'
  | 'key'
  | 'operator'
  | 'value'
  | 'text';

export interface Token {
  kind: TokenKind;
  text: string;
}

const COMMENT = /^(\s*)(#.*)$/;
const ENTRY = /^(\s*)(?:(export)(\s+))?([A-Za-z_][\w.-]*)(\s*=\s*)(.*)$/;

/** Where a quoted value starting at 0 ends (after its closing quote). */
function quotedEnd(rest: string): number {
  const quote = rest[0]!;
  for (let at = 1; at < rest.length; at++) {
    if (quote === '"' && rest[at] === '\\') at++;
    else if (rest[at] === quote) return at + 1;
  }
  return rest.length;
}

/** The value and what follows it: spaces and a comment, or more text. */
function valueTokens(rest: string): Token[] {
  const end =
    rest.startsWith('"') || rest.startsWith("'")
      ? quotedEnd(rest)
      : (() => {
          const hash = rest.search(/\s#/);
          return hash === -1 ? rest.length : hash;
        })();
  const tokens: Token[] = [];
  if (end > 0) tokens.push({ kind: 'value', text: rest.slice(0, end) });
  const after = rest.slice(end);
  const comment = COMMENT.exec(after);
  if (comment && comment[1]) {
    tokens.push({ kind: 'text', text: comment[1] });
    tokens.push({ kind: 'comment', text: comment[2]! });
  } else if (after) tokens.push({ kind: 'text', text: after });
  return tokens;
}

/** The tokens of one line of an env file. */
export function tokenize(line: string): Token[] {
  const comment = COMMENT.exec(line);
  if (comment)
    return [
      ...(comment[1] ? [{ kind: 'text' as const, text: comment[1] }] : []),
      { kind: 'comment', text: comment[2]! },
    ];
  const entry = ENTRY.exec(line);
  if (!entry) return line ? [{ kind: 'text', text: line }] : [];
  const [, indent, keyword, gap, key, operator, rest] = entry;
  const tokens: Token[] = [];
  if (indent) tokens.push({ kind: 'text', text: indent });
  if (keyword) {
    tokens.push({ kind: 'keyword', text: keyword });
    tokens.push({ kind: 'text', text: gap! });
  }
  tokens.push({ kind: 'key', text: key! });
  tokens.push({ kind: 'operator', text: operator! });
  return [...tokens, ...valueTokens(rest!)];
}
