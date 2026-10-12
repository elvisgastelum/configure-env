// The portal's half of the session handoff. The API prints a launch URL,
// `GET /launch?token=…`, that sets the session as an HttpOnly SameSite=Strict
// cookie and redirects to `/` (apps/api/src/security.ts), so the token never
// reaches the portal. When the portal is opened with the token in its own
// URL instead (`/?token=…`, as with `pnpm dev` behind the Vite proxy), it
// makes the same trade: it removes the token from the address bar and the
// history entry with `history.replaceState`, then sends it once to
// `/launch`, whose response sets the cookie. Script never keeps the token.

export const TOKEN_PARAM = 'token';
export const LAUNCH_PATH = '/launch';

interface LaunchEnvironment {
  location: Pick<Location, 'href'>;
  history: Pick<History, 'replaceState' | 'state'>;
  fetch: typeof fetch;
}

/** Trades a `?token=` in the URL for the session cookie; true when there was one. */
export async function consumeLaunchToken(
  env: LaunchEnvironment = window,
): Promise<boolean> {
  const url = new URL(env.location.href);
  const token = url.searchParams.get(TOKEN_PARAM);
  if (token === null) return false;

  // Clean first: the token leaves the address bar even if the trade fails.
  url.searchParams.delete(TOKEN_PARAM);
  env.history.replaceState(
    env.history.state,
    '',
    `${url.pathname}${url.search}${url.hash}`,
  );

  // The 303 to `/` is not followed: only its Set-Cookie matters here.
  await env
    .fetch(`${LAUNCH_PATH}?${TOKEN_PARAM}=${encodeURIComponent(token)}`, {
      credentials: 'same-origin',
      redirect: 'manual',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    })
    .catch(() => undefined);
  return true;
}
