// See load-server.js. The shapes are serve.ts's copies of the API's
// ServerOptions and ApiServer.

import type { StateWriter } from '@configure-env/core';
import type { ApiServer, ServerOptions } from './serve.ts';

export declare function loadServer(): Promise<{
  createServer(
    options: ServerOptions & {
      statePath?: string;
      schemaAnywhere?: boolean;
      cwd?: string;
      writeState?: StateWriter;
    },
  ): Promise<ApiServer>;
}>;
