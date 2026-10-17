// The fetch every generated function goes through (orval's mutator). In the
// portal a request has no target: it stays relative, so it is same-origin
// and carries the session cookie the launch URL set. In Node (the CLI) a
// request names its target: the server's base URL, its bearer token, and
// the client sending it, as the X-Configure-Env-Client header.

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
export type ApiRequestInit = RequestInit & { target?: ApiTarget };

/** The header naming the client that sends a request. */
export const CLIENT_HEADER = 'X-Configure-Env-Client';

/** `url` (an `/api/…` path) against the target, or as is without one. */
export function targetUrl(url: string, target?: ApiTarget): string {
  if (!target) return url;
  return `${target.baseUrl.replace(/\/+$/, '')}${url}`;
}

/**
 * Sends the request and answers what orval's fetch client expects: the
 * parsed body (empty for a body-less status) with the status and headers.
 */
export async function apiFetch<T>(
  url: string,
  { target, ...init }: ApiRequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (target) {
    headers.set('Authorization', `Bearer ${target.token}`);
    headers.set(CLIENT_HEADER, target.client);
  }
  const res = await fetch(targetUrl(url, target), {
    ...init,
    headers,
    // A token is never sent along a redirect to somewhere else.
    ...(target ? { redirect: 'error' as const } : {}),
  });
  const body = [204, 205, 304].includes(res.status) ? null : await res.text();
  const data: unknown = body ? JSON.parse(body) : {};
  return { data, status: res.status, headers: res.headers } as T;
}

export default apiFetch;
