// The typed client of the configure-env API, generated from its OpenAPI
// document (pnpm gen:api). The portal is served by the API itself, so every
// request is relative: same-origin, with the session cookie the launch URL
// set, under the base path of the environment the portal shows. Node code
// imports @configure-env/api-client/client instead, which names a server's
// URL and token (src/fetcher.ts).

export * from './generated/api.ts';
export { apiBasePath, environmentBasePath, setApiBasePath } from './fetcher.ts';
