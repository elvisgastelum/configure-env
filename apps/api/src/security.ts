// The guard in front of every request, static files included: the Host and
// Origin a browser sends must be this server's own (against DNS rebinding
// and CSRF), and the per-run token must come with it, as a bearer header or
// as the cookie the launch URL sets. No CORS: a preflight is refused, and no
// response carries an Access-Control header.

import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** The path that exchanges `?token=` for the session cookie. */
export const LAUNCH_PATH = '/launch';

const SAFE_METHODS = new Set(['GET', 'HEAD']);
// `same-site` covers other ports on the same host: still another origin.
const ALLOWED_FETCH_SITES = new Set(['same-origin', 'none']);

export interface SecurityOptions {
  token: string;
  /** The `host:port` values the Host header may hold, lowercase; known once listening. */
  hosts: () => ReadonlySet<string>;
  /** The cookie name; it carries the port, as cookies are not port-scoped. */
  cookie: () => string;
  /**
   * The origins (`scheme://host[:port]`) the Origin header may hold; known
   * once listening. Without it, `http://` followed by one of the hosts.
   */
  origins?: () => ReadonlySet<string>;
  /** Marks the session cookie Secure: the browser reaches the server over HTTPS. */
  secure?: boolean;
}

type Request = IncomingMessage & { originalUrl?: string };
type Next = (error?: unknown) => void;

const digest = (text: string) => createHash('sha256').update(text).digest();

/** Compares in constant time, whatever the lengths. */
export const sameToken = (expected: string, given: string) =>
  timingSafeEqual(digest(expected), digest(given));

/** The value of cookie `name` in a Cookie header. */
export function cookieValue(
  header: string | undefined,
  name: string,
): string | undefined {
  for (const part of header?.split(';') ?? []) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name)
      return decodeURIComponent(part.slice(index + 1).trim());
  }
  return undefined;
}

function deny(
  res: ServerResponse,
  statusCode: number,
  message: string,
  headers: Record<string, string> = {},
) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify({ statusCode, message }));
}

/** Connect-style middleware enforcing the rules above. */
export function securityMiddleware(options: SecurityOptions) {
  return (req: Request, res: ServerResponse, next: Next) => {
    const hosts = options.hosts();
    const host = req.headers.host?.toLowerCase();
    if (!host || !hosts.has(host))
      return deny(
        res,
        403,
        'host not allowed: this server answers only its own address',
      );

    const origin = req.headers.origin;
    if (origin !== undefined && !allowedOrigin(origin, hosts, options))
      return deny(
        res,
        403,
        'origin not allowed: cross-origin requests are refused',
      );
    const site = req.headers['sec-fetch-site'];
    if (typeof site === 'string' && !ALLOWED_FETCH_SITES.has(site))
      return deny(
        res,
        403,
        'origin not allowed: cross-site requests are refused',
      );
    if (req.method === 'OPTIONS')
      return deny(res, 403, 'CORS is not supported');

    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === LAUNCH_PATH) return launch(req, res, url, options);

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');

    const authorization = req.headers.authorization;
    const bearer = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : undefined;
    if (bearer !== undefined) {
      if (!sameToken(options.token, bearer)) return unauthorized(res);
      return next();
    }
    const cookie = cookieValue(req.headers.cookie, options.cookie());
    if (cookie === undefined || !sameToken(options.token, cookie))
      return isPageRequest(req, url) ? signedOut(res) : unauthorized(res);
    // A browser sends the cookie on its own; a change must prove its origin.
    if (!SAFE_METHODS.has(req.method ?? 'GET') && origin === undefined)
      return deny(
        res,
        403,
        'origin required: a cookie-authenticated change must send its Origin',
      );
    return next();
  };
}

/** Whether an Origin header names this server: one of the allowed origins. */
function allowedOrigin(
  origin: string,
  hosts: ReadonlySet<string>,
  options: SecurityOptions,
): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.pathname !== '/') return false;
  if (options.origins) return options.origins().has(url.origin);
  return url.protocol === 'http:' && hosts.has(url.host);
}

const unauthorized = (res: ServerResponse) =>
  deny(res, 401, 'a valid token is required', { 'WWW-Authenticate': 'Bearer' });

/** A browser opening a page (not the API, not an asset fetch). */
function isPageRequest(req: Request, url: URL): boolean {
  return (
    SAFE_METHODS.has(req.method ?? 'GET') &&
    !url.pathname.startsWith('/api/') &&
    (req.headers.accept ?? '').includes('text/html')
  );
}

/**
 * A tab without the session, such as one opened on the bare address: still
 * a 401 and nothing of the portal, but a page saying what to do instead of
 * the JSON error.
 */
const SIGNED_OUT_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>configure-env</title>
<style>
:root { color-scheme: light dark; font-family: system-ui, sans-serif; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 1rem; box-sizing: border-box; }
main { max-width: 32rem; }
h1 { font-size: 1.25rem; }
code { font-size: 0.9em; }
</style>
</head>
<body>
<main>
<h1>Open the launch link again</h1>
<p>This tab has no session for this server. Open the link <code>configure-env serve</code> printed when it started, or restart it to get a new one.</p>
</main>
</body>
</html>
`;

function signedOut(res: ServerResponse) {
  res.writeHead(401, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'WWW-Authenticate': 'Bearer',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
  });
  res.end(SIGNED_OUT_PAGE);
}

/** `GET /launch?token=…`: sets the session cookie and redirects to the portal. */
function launch(
  req: Request,
  res: ServerResponse,
  url: URL,
  options: SecurityOptions,
) {
  const token = url.searchParams.get('token');
  if (!SAFE_METHODS.has(req.method ?? 'GET') || token === null)
    return deny(res, 400, 'open the launch URL the server printed');
  if (!sameToken(options.token, token)) return unauthorized(res);
  res.writeHead(303, {
    Location: '/',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'Set-Cookie': `${options.cookie()}=${encodeURIComponent(options.token)}; HttpOnly; SameSite=Strict; Path=/${options.secure ? '; Secure' : ''}`,
  });
  res.end();
}
