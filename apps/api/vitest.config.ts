import { defineConfig } from 'vite-plus';

export default defineConfig({
  // Nest's decorators are TypeScript's legacy (experimental) ones.
  oxc: { decorator: { legacy: true } },
  test: { include: ['src/**/*.test.ts'] },
});
