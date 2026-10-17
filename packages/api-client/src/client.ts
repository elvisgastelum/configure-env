// The typed client for Node, such as the CLI: the same functions as the
// portal's (src/index.ts) without the React Query hooks, so nothing imports
// React. Each takes the server as its last argument's `target`:
//
//   await getCheck({ strict: 'true' }, { target: { baseUrl, token, client: 'cli' } });

export * from './generated/client.ts';
export {
  type ApiRequestInit,
  type ApiTarget,
  CLIENT_HEADER,
  apiFetch,
  targetUrl,
} from './fetcher.ts';
