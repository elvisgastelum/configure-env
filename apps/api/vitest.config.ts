import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Nest's decorators are TypeScript's legacy (experimental) ones.
  oxc: { decorator: { legacy: true } },
  test: { include: ['src/**/*.test.ts'] },
});
