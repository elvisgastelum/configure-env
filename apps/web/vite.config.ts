// The portal's build: React, Tailwind, and TanStack Router's file routes
// (src/routes, generated into src/routeTree.gen.ts, as `pnpm routes` does
// from tsr.config.json). The output is a static `dist/` the local API serves
// behind its token (`createServer({ staticDir })`).
//
// `pnpm dev` proxies the API: start it with `pnpm --filter @configure-env/api
// start` and set CONFIGURE_ENV_API to the URL it prints, then open
// `http://localhost:5173/?token=<token>`; the portal trades the token for the
// session cookie (src/lib/launch.ts).

import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const api = process.env.CONFIGURE_ENV_API ?? 'http://127.0.0.1:4310';

/** The API answers only its own Host and Origin; the proxy speaks as it. */
const proxy = {
  target: api,
  changeOrigin: true,
  configure: (server: {
    on(
      event: 'proxyReq',
      listener: (request: {
        getHeader(name: string): unknown;
        setHeader(name: string, value: string): void;
      }) => void,
    ): void;
  }) => {
    server.on('proxyReq', (request) => {
      if (request.getHeader('origin')) request.setHeader('origin', api);
    });
  },
};

export default defineConfig({
  plugins: [
    // Before React, so the route files are code-split before they compile.
    tanstackRouter({
      target: 'react',
      routesDirectory: './src/routes',
      generatedRouteTree: './src/routeTree.gen.ts',
      quoteStyle: 'single',
      autoCodeSplitting: true,
    }),
    react(),
    tailwindcss(),
  ],
  server: { proxy: { '/api': proxy, '/launch': proxy } },
  build: { outDir: 'dist', emptyOutDir: true },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'jsdom',
          include: ['src/**/*.test.{ts,tsx}'],
          setupFiles: ['src/test/setup.ts'],
          // Most tests render the whole app and click through menus and
          // dialogs, which takes a few seconds on a slow CI runner.
          testTimeout: 15_000,
        },
      },
      {
        // Builds the portal and serves it from the real API, under Node.
        // The API's Nest decorators are TypeScript's legacy ones.
        oxc: { decorator: { legacy: true } },
        test: {
          name: 'serve',
          environment: 'node',
          include: ['test/**/*.test.ts'],
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
