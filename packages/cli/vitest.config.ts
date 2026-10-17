import { defineConfig } from 'vite-plus';

export default defineConfig({
  // `serve` runs @configure-env/api from its sources, and Nest's decorators
  // are TypeScript's legacy (experimental) ones.
  oxc: { decorator: { legacy: true } },
});
