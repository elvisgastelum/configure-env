// The fetch every generated function goes through (orval's mutator). In the
// portal a request has no target: it stays relative, so it is same-origin
// and carries the session cookie the launch URL set; the base path the
// portal's environment picker sets (`/env/<name>`) sends it through the
// local server's gateway to another environment, still same-origin. In
// Node (the CLI) a request names its target: the server's base URL, its
// bearer token, and the client sending it, as the X-Configure-Env-Client
// header.

/** A configure-env server outside the page: where it is and how to sign in. */
export interface ApiTarget {
  /** `http(s)://host[:port]`, with an optional path prefix. */
  baseUrl: string;
  /** Sent as `Authorization: Bearer <token>`; never logged. */
  token: string;
  /** The X-Configure-Env-Client header, such as `cli`. */
  client: string;
}

/** A request's options: fetch's own, plus the server it goes to. */
export type ApiRequestInit = RequestInit & {
  target?: ApiTarget;
  /**
   * Sent to the server that serves the portal whatever the base path, such
   * as GET /api/environments, which lists the environments to switch to.
   */
  local?: boolean;
};

/** The header naming the client that sends a request. */
export const CLIENT_HEADER = 'X-Configure-Env-Client';

let basePath = '';

/** The path relative requests start with: empty for the serving server. */
export const apiBasePath = () => basePath;

/**
 * Sends the relative requests from now on under `path`, such as `/env/dev`
 * for that environment through the local gateway; empty for the serving
 * server itself. A path is absolute, without a trailing slash.
 */
export function setApiBasePath(path: string): void {
  if (path !== '' && !/^\/[^/]+(\/[^/]+)*$/.test(path))
    throw new Error(`not a base path: ${path}`);
  basePath = path;
}

/** The base path of an environment: `/env/<name>`, empty for `local`. */
export const environmentBasePath = (name: string) =>
  name === 'local' ? '' : `/env/${encodeURIComponent(name)}`;

/**
 * `url` (an `/api/…` path) against the target, or under the base path
 * without one (unless `local`).
 */
export function targetUrl(
  url: string,
  target?: ApiTarget,
  local = false,
): string {
  if (!target) return local ? url : `${basePath}${url}`;
  return `${target.baseUrl.replace(/\/+$/, '')}${url}`;
}

/**
 * Sends the request and answers what orval's fetch client expects: the body
 * (parsed when it is JSON, as text otherwise, such as the event stream; empty
 * for a body-less status) with the status and headers.
 */
export async function apiFetch<T>(
  url: string,
  { target, local, ...init }: ApiRequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (target) {
    headers.set('Authorization', `Bearer ${target.token}`);
    headers.set(CLIENT_HEADER, target.client);
  }
  const res = await fetch(targetUrl(url, target, local), {
    ...init,
    headers,
    // A token is never sent along a redirect to somewhere else.
    ...(target ? { redirect: 'error' as const } : {}),
  });
  const body = [204, 205, 304].includes(res.status) ? null : await res.text();
  const json = /\bjson\b/i.test(res.headers.get('content-type') ?? '');
  const data: unknown =
    body === null ? {} : json ? (body ? JSON.parse(body) : {}) : body;
  return { data, status: res.status, headers: res.headers } as T;
}

export default apiFetch;
