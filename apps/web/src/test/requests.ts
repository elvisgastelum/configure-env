import { server } from './server';

/**
 * Every request whose path starts with `prefix`, as [method, path, body] in
 * the order sent; the array fills as the test runs.
 */
export function recordRequests(prefix: string) {
  const requests: [string, string, unknown][] = [];
  server.events.on('request:start', async ({ request }) => {
    const path = new URL(request.url).pathname;
    if (path.startsWith(prefix))
      requests.push([request.method, path, await request.clone().json()]);
  });
  return requests;
}
