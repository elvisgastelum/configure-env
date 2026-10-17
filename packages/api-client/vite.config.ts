import { defineConfig } from 'vite-plus';

// The generator starts pnpm, which keeps its own run state there.
const pnpmRunState = {
  pattern: '!node_modules/.pnpm-task-run-state-v1/**',
  base: 'workspace',
} as const;

export default defineConfig({
  run: {
    tasks: {
      test: 'vp test run',
      'gen:api:check': {
        command: 'tsx --tsconfig tsconfig.json scripts/gen-api.ts --check',
        cache: {
          input: [{ auto: true }, pnpmRunState],
          output: [{ auto: true }, pnpmRunState],
        },
      },
    },
  },
});
