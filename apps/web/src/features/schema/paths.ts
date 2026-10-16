// The JSON paths the API and the core's schema writer report, like
// `files[1].variables[0]`, read back into their segments so an error can be
// shown on the form field it is about. The inverse of the core's
// `formatIssuePath`.

export type PathSegment = string | number;

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*/;
const INDEX = /^\[(\d+)\]/;

/** The segments of `path`; [] for `(root)`, undefined when it is not a path. */
export function parseIssuePath(path: string): PathSegment[] | undefined {
  if (path === '(root)') return [];
  const segments: PathSegment[] = [];
  let rest = path;
  while (rest) {
    const index = INDEX.exec(rest);
    if (index) {
      segments.push(Number(index[1]));
      rest = rest.slice(index[0].length);
      continue;
    }
    if (rest.startsWith('["')) {
      const end = quotedEnd(rest, 1);
      if (end === undefined || rest[end + 1] !== ']') return undefined;
      segments.push(JSON.parse(rest.slice(1, end + 1)) as string);
      rest = rest.slice(end + 2);
      continue;
    }
    const dotted = segments.length > 0;
    if (dotted && !rest.startsWith('.')) return undefined;
    const name = IDENTIFIER.exec(dotted ? rest.slice(1) : rest);
    if (!name) return undefined;
    segments.push(name[0]);
    rest = rest.slice(name[0].length + (dotted ? 1 : 0));
  }
  return segments;
}

/** The offset of the quote closing the JSON string that opens at `start`. */
function quotedEnd(text: string, start: number): number | undefined {
  for (let at = start + 1; at < text.length; at++) {
    if (text[at] === '\\') at++;
    else if (text[at] === '"') return at;
  }
  return undefined;
}
