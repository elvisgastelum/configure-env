// drizzle-kit generates the state database's migrations from its schema:
//   pnpm --filter @configure-env/core db:generate
// They are applied by the core when it opens a database (engine/state.ts),
// and the published CLI ships them in dist/migrations.

import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/engine/db-schema.ts',
  out: './drizzle',
});
