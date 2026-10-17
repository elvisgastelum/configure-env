// The gateway to the other environments (`configure-env env add`): the
// portal stays on this server, same-origin with its session cookie, and
// reaches another environment's API through `/env/<name>/api/*`, which this
// server forwards with that environment's bearer token. A path prefix, not
// a header, names the environment, as EventSource cannot send headers.
//
// It runs after the guard of src/security.ts, so a request carries this
// server's own token first. It forwards only to the environments the list
// names, only under their `/api/`, and only an allowlist of headers each
// way: the browser's cookie, Origin, Referer and Sec-Fetch-* headers, this
// server's bearer, and every hop-by-hop header stay here; the other
// server's cookies and CORS headers never reach the browser. No answer,
// error message or log line ever holds a token.

import {
  type IncomingHttpHeaders,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type ServerResponse,
  request as httpRequest,
} from 'node:http';
import { request as httpsRequest } from 'node:https';

/** Another environment's server: its URL (with an optional path prefix) and token. */
export interface RemoteEnvironment {
  url: string;
  token: string;
}

/** The environments by name, read on every request so a change applies at once. */
export type EnvironmentsReader = () => Promise<
  Readonly<Record<string, RemoteEnvironment>>
>;

/** What the gateway and GET /api/environments read. */
export interface EnvironmentsSource {
  read: EnvironmentsReader;
  /** This server's own URL, for the `local` entry; known once listening. */
  url: () => string;
}

/** The name that always means this server's own project. */
export const LOCAL = 'local';
/** The prefix of the forwarded paths. */
export const GATEWAY_PREFIX = '/env/';
/** The X-Configure-Env-Client header of the requests the gateway sends. */
export const GATEWAY_CLIENT = 'portal';

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** How long the other server may take to start answering. */
const FORWARD_TIMEOUT_MS = 30_000;
/** How long GET /api/environments waits for each environment. */
const PROBE_TIMEOUT_MS = 3_000;

/** The browser's headers the other server gets; everything else stays here. */
const REQUEST_HEADERS = [
  'accept',
  'accept-language',
  'content-type',
  'content-length',
  'if-match',
  'if-none-match',
  'if-modified-since',
  'if-unmodified-since',
  'last-event-id',
  'user-agent',
];

/** The policy every forwarded answer carries. */
const FORWARDED_CSP = "default-src 'none'; frame-ancestors 'none'";

/** The other server's headers the browser gets. */
const RESPONSE_HEADERS = [
  'content-type',
  'content-length',
  'content-encoding',
  'content-language',
  'etag',
  'last-modified',
  'retry-after',
];

/** Thrown for a request the gateway refuses: its status and message. */
class GatewayError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

function answer(res: ServerResponse, statusCode: number, message: string) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify({ statusCode, message }));
}

/** The URL as messages show it: no credentials, query or fragment. */
const shownUrl = (url: URL) =>
  `${url.origin}${url.pathname}`.replace(/\/+$/, '');

/** An environment's URL, or the error saying it is not usable. */
function environmentUrl(name: string, environment: RemoteEnvironment): URL {
  let url: URL | undefined;
  try {
    url = new URL(environment.url);
  } catch {
    url = undefined;
  }
  if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:'))
    throw new GatewayError(
      502,
      `environment ${name} has no usable http or https URL`,
    );
  return url;
}

/**
 * The stored environment a name (as the path holds it, still encoded)
 * names; `local` and anything else the list does not hold are a 404.
 */
async function environmentNamed(
  read: EnvironmentsReader,
  encoded: string,
): Promise<{ name: string; environment: RemoteEnvironment }> {
  let name: string | undefined;
  try {
    name = decodeURIComponent(encoded);
  } catch {
    name = undefined;
  }
  if (name === undefined || !NAME.test(name))
    throw new GatewayError(404, 'no such environment');
  if (name === LOCAL)
    throw new GatewayError(
      404,
      `${LOCAL} is this server's own project: use /api/ directly`,
    );
  const environments = await readEnvironments(read);
  const environment = Object.hasOwn(environments, name)
    ? environments[name]
    : undefined;
  if (!environment) throw new GatewayError(404, `no environment named ${name}`);
  return { name, environment };
}

async function readEnvironments(read: EnvironmentsReader) {
  try {
    return await read();
  } catch (error) {
    // The reader's messages name the file and the fields, never a value.
    throw new GatewayError(
      500,
      `cannot read the environments: ${(error as Error).message}`,
    );
  }
}

/**
 * The `/api/…` path under the environment, as given: every segment plain,
 * no `.` or `..`, no empty one, and no slash or backslash hidden in an
 * escape, so the path cannot leave the other server's `/api/`.
 */
function apiPath(path: string): string[] {
  const segments = path.split('/').slice(1);
  if (segments.length < 2 || segments[0] !== 'api')
    throw new GatewayError(404, 'only /env/<name>/api/ paths are forwarded');
  for (const segment of segments) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw new GatewayError(404, 'not a path the gateway forwards');
    }
    if (
      decoded === '' ||
      decoded === '.' ||
      decoded === '..' ||
      /[/\\]/.test(decoded) ||
      segment.includes('\\')
    )
      throw new GatewayError(404, 'not a path the gateway forwards');
  }
  return segments;
}

/** The names a Connection header lists: hop-by-hop for this one message. */
const connectionNames = (headers: IncomingHttpHeaders) =>
  new Set(
    String(headers.connection ?? '')
      .split(',')
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean),
  );

/** The allowlisted headers of `headers`, minus what its Connection names. */
function pick(
  headers: IncomingHttpHeaders,
  names: readonly string[],
): OutgoingHttpHeaders {
  const hop = connectionNames(headers);
  const picked: OutgoingHttpHeaders = {};
  for (const name of names) {
    const value = headers[name];
    if (value !== undefined && !hop.has(name)) picked[name] = value;
  }
  return picked;
}

const failure = (error: unknown) =>
  (error as NodeJS.ErrnoException).code ?? (error as Error).message;

/**
 * Sends a request to the environment: its token as the bearer, the given
 * headers, and `body` piped in when there is one. Resolves with the
 * response once its headers arrive; rejects with a 502 naming the
 * environment otherwise. A request Node refuses outright, such as a token
 * no header can hold, throws that 502 at once (naming the error's code
 * only: its message may quote the header).
 */
function upstream(
  name: string,
  environment: RemoteEnvironment,
  path: string,
  init: {
    method: string;
    headers: OutgoingHttpHeaders;
    body?: IncomingMessage;
    timeoutMs: number;
  },
): { response: Promise<IncomingMessage>; abort: () => void } {
  const base = environmentUrl(name, environment);
  const send = base.protocol === 'https:' ? httpsRequest : httpRequest;
  const unusable = (error: unknown) =>
    new GatewayError(
      502,
      `environment ${name} at ${shownUrl(base)} cannot be sent a request: ${(error as NodeJS.ErrnoException).code ?? 'invalid request'}`,
    );
  let outgoing: ReturnType<typeof send>;
  try {
    outgoing = send({
      protocol: base.protocol,
      hostname: base.hostname.replace(/^\[(.*)\]$/, '$1'),
      port: base.port || undefined,
      method: init.method,
      path: `${base.pathname.replace(/\/+$/, '')}${path}`,
      headers: {
        ...init.headers,
        authorization: `Bearer ${environment.token}`,
        'x-configure-env-client': GATEWAY_CLIENT,
      },
      timeout: init.timeoutMs,
    });
  } catch (error) {
    throw unusable(error);
  }
  const response = new Promise<IncomingMessage>((resolve, reject) => {
    const unreachable = (reason: string) =>
      reject(
        new GatewayError(
          502,
          `environment ${name} at ${shownUrl(base)} is unreachable: ${reason}`,
        ),
      );
    outgoing.once('timeout', () => {
      unreachable('timed out');
      outgoing.destroy();
    });
    outgoing.once('error', (error) => unreachable(failure(error)));
    outgoing.once('response', (incoming) => {
      // Once it answers, a stream such as the events may stay open.
      outgoing.setTimeout(0);
      resolve(incoming);
    });
  });
  if (init.body) init.body.pipe(outgoing);
  else outgoing.end();
  return { response, abort: () => outgoing.destroy() };
}

/** Connect-style middleware forwarding `/env/<name>/api/*`. */
export function gatewayMiddleware(read: EnvironmentsReader) {
  return (
    req: IncomingMessage,
    res: ServerResponse,
    next: (error?: unknown) => void,
  ) => {
    const raw = req.url ?? '/';
    if (!raw.startsWith(GATEWAY_PREFIX)) return next();
    forward(read, req, res).catch((error: unknown) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (error instanceof GatewayError)
        return answer(res, error.statusCode, error.message);
      answer(res, 502, 'the gateway failed');
    });
  };
}

async function forward(
  read: EnvironmentsReader,
  req: IncomingMessage,
  res: ServerResponse,
) {
  const raw = (req.url ?? '/').slice(GATEWAY_PREFIX.length);
  const queryAt = raw.indexOf('?');
  const path = queryAt === -1 ? raw : raw.slice(0, queryAt);
  const query = queryAt === -1 ? '' : raw.slice(queryAt);
  const slash = path.indexOf('/');
  if (slash <= 0)
    throw new GatewayError(404, 'only /env/<name>/api/ paths are forwarded');
  const segments = apiPath(path.slice(slash));
  const { name, environment } = await environmentNamed(
    read,
    path.slice(0, slash),
  );
  // Routes match without regard to case, and a segment may be escaped.
  if (decodeURIComponent(segments[1]!).toLowerCase() === 'open-in-editor')
    throw new GatewayError(
      403,
      `open-in-editor opens files on the machine of the portal; environment ${name} is another server`,
    );

  const method = req.method ?? 'GET';
  const hasBody = method !== 'GET' && method !== 'HEAD';
  const sent = upstream(name, environment, `/${segments.join('/')}${query}`, {
    method,
    headers: pick(req.headers, REQUEST_HEADERS),
    ...(hasBody ? { body: req } : {}),
    timeoutMs: FORWARD_TIMEOUT_MS,
  });
  // The browser going away (a closed tab, a closed event stream) ends it.
  res.once('close', () => {
    if (!res.writableFinished) sent.abort();
  });
  const incoming = await sent.response;
  if (incoming.statusCode === 401) {
    incoming.resume();
    throw new GatewayError(
      502,
      `environment ${name} refused its token: run configure-env env remove ${name}, then env add it with the right one`,
    );
  }
  res.writeHead(incoming.statusCode ?? 502, {
    ...pick(incoming.headers, RESPONSE_HEADERS),
    // Whatever type it claims, nothing in it runs, loads or is framed.
    'content-security-policy': FORWARDED_CSP,
  });
  // An event stream goes out as it comes.
  res.flushHeaders();
  incoming.on('error', () => res.destroy());
  incoming.pipe(res);
}

/** An environment as GET /api/environments lists it: never its token. */
export interface EnvironmentStatus {
  name: string;
  url: string;
  local: boolean;
  reachable: boolean;
  version?: string;
  message?: string;
}

/** Asks an environment for its project: whether it answers, and its version. */
async function probe(
  name: string,
  environment: RemoteEnvironment,
): Promise<EnvironmentStatus> {
  let url: string;
  try {
    url = shownUrl(environmentUrl(name, environment));
  } catch (error) {
    return {
      name,
      url: '',
      local: false,
      reachable: false,
      message: (error as Error).message,
    };
  }
  const status = { name, url, local: false };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const sent = upstream(name, environment, '/api/project', {
      method: 'GET',
      headers: { accept: 'application/json' },
      timeoutMs: PROBE_TIMEOUT_MS,
    });
    timer = setTimeout(sent.abort, PROBE_TIMEOUT_MS);
    const incoming = await sent.response;
    let text = '';
    incoming.setEncoding('utf8');
    for await (const chunk of incoming) text += chunk as string;
    if (incoming.statusCode === 401)
      return { ...status, reachable: false, message: 'refused its token' };
    if (incoming.statusCode !== 200)
      return {
        ...status,
        reachable: false,
        message: `answered ${incoming.statusCode}`,
      };
    const version = (JSON.parse(text) as { version?: unknown }).version;
    return {
      ...status,
      reachable: true,
      ...(typeof version === 'string' ? { version } : {}),
    };
  } catch (error) {
    const message =
      error instanceof GatewayError
        ? error.message.replace(
            /^.* (is unreachable|cannot be sent a request): /,
            '',
          )
        : 'did not answer as a configure-env server';
    return { ...status, reachable: false, message };
  } finally {
    clearTimeout(timer);
  }
}

/** GET /api/environments: this server, then each environment, probed at once. */
export async function listEnvironments(
  source: EnvironmentsSource,
  version: string,
): Promise<EnvironmentStatus[]> {
  let environments: Readonly<Record<string, RemoteEnvironment>>;
  try {
    environments = await source.read();
  } catch (error) {
    throw new GatewayError(
      500,
      `cannot read the environments: ${(error as Error).message}`,
    );
  }
  const others = await Promise.all(
    Object.entries(environments)
      .filter(([name]) => name !== LOCAL && NAME.test(name))
      .map(([name, environment]) => probe(name, environment)),
  );
  return [
    { name: LOCAL, url: source.url(), local: true, reachable: true, version },
    ...others,
  ];
}

export { GatewayError };
