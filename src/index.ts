// The programmatic API: load a schema, plan and apply its files, check them
// for drift, and edit dotenv text. The CLI is built on the same functions.
// See the README, "Programmatic API".

export {
  DEFAULT_SCHEMA_PATH,
  loadSchema,
  parseSchema,
  parseSchemaText,
} from './schema/load.ts';
export type { SchemaError, SchemaResult } from './schema/load.ts';

export {
  FILE_POLICIES,
  SCHEMA_ID,
  SCHEMA_VERSION,
  TEMPLATE_SUFFIXES,
  VARIABLE_TYPES,
  envSchema,
  isTemplate,
} from './schema/definition.ts';
export type {
  EnvSchema,
  FilePolicy,
  FileSpec,
  VariableSpec,
  VariableType,
} from './schema/definition.ts';

export {
  formatValue,
  maskValue,
  unquoteValue,
  validateValue,
} from './schema/values.ts';
export type { ValueResult, VariableValue } from './schema/values.ts';

export { planChanges, validateValues } from './engine/plan.ts';
export type {
  FileAction,
  FilePlan,
  Plan,
  PlanError,
  PlanOptions,
  ValueError,
} from './engine/plan.ts';

export { applyPlan } from './engine/apply.ts';
export type { ApplyFs, ApplyOptions, ApplyResult } from './engine/apply.ts';

export { checkDrift } from './engine/check.ts';
export type {
  CheckOptions,
  DriftReport,
  DriftStatus,
  FileDrift,
  InvalidValue,
} from './engine/check.ts';

export {
  appendLines,
  getValue,
  invalidLineNumbers,
  keysOf,
  parseDotenv,
  removeEntry,
  removeKey,
  serialize,
  setValue,
} from './engine/dotenv.ts';
export type {
  DotenvDocument,
  DotenvLine,
  Eol,
  LineKind,
} from './engine/dotenv.ts';

export { main } from './cli/main.ts';
export type { Io, Prompts } from './cli/io.ts';
