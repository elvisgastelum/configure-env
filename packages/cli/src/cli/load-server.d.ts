// See load-server.js. The shapes are serve.ts's copies of the API's
// ServerOptions and ApiServer.

import type { ApiServer, ServerOptions } from './serve.ts';

export declare function loadServer(): Promise<{
  createServer(
    options: ServerOptions & { statePath?: string; schemaAnywhere?: boolean },
  ): Promise<ApiServer>;
}>;
