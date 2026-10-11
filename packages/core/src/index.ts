// The engine every configure-env surface shares: the schema and its values,
// dotenv text, planning and applying files, checking them for drift, and the
// protected variables' state. The published CLI bundles it; its public API
// (packages/cli/src/index.ts) re-exports a chosen part of it.

export * from './schema/definition.ts';
export * from './schema/ip.ts';
export * from './schema/json-schema.ts';
export * from './schema/load.ts';
export * from './schema/values.ts';
export * from './engine/apply.ts';
export * from './engine/check.ts';
export * from './engine/dotenv.ts';
export * from './engine/paths.ts';
export * from './engine/plan.ts';
export * from './engine/state.ts';
