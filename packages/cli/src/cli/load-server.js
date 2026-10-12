// The API server (@configure-env/api, NestJS), imported only when `serve`
// runs, into a chunk of its own. Plain JavaScript with a hand-written
// declaration (load-server.d.ts), so TypeScript, both the checker and the
// declaration build, never loads the API's sources and NestJS's types: they
// would multiply the build's memory for declarations nothing exports.

export const loadServer = () => import('@configure-env/api');
