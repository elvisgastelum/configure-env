// The programmatic API: load a schema, plan and apply its files, check them
// for drift, edit dotenv text, and read or write the protected variables'
// state. The CLI is built on the same functions.
// See the README, "Programmatic API".

export {
  DEFAULT_SCHEMA_PATH,
  loadSchema,
  parseSchema,
  parseSchemaText,
} from './schema/load.ts';
export type { SchemaError, SchemaResult } from './schema/load.ts';

export {
  ENCODINGS,
  FILE_POLICIES,
  RULE_FIELDS,
  SCHEMA_ID,
  SCHEMA_VERSION,
  TEMPLATE_SUFFIXES,
  VARIABLE_TYPES,
  envSchema,
  isTemplate,
  protectedReason,
} from './schema/definition.ts';
export type {
  Encoding,
  EnvSchema,
  FilePolicy,
  FileSpec,
  RuleField,
  VariableSpec,
  VariableType,
} from './schema/definition.ts';

export {
  checkRules,
  formatValue,
  maskValue,
  ruleKeys,
  unquoteValue,
  validateValue,
} from './schema/values.ts';
export type {
  RuleProblem,
  ValueResult,
  VariableValue,
} from './schema/values.ts';

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

export { checkDrift, fileRules, protectedMismatches } from './engine/check.ts';
export type {
  CheckOptions,
  DriftReport,
  DriftStatus,
  FileDrift,
  InvalidValue,
  ProtectedMismatch,
} from './engine/check.ts';

export {
  DEFAULT_STATE_PATH,
  emptyState,
  fingerprint,
  loadState,
  matchesFingerprint,
  recordFingerprint,
  recorded,
  removeFingerprint,
  writeState,
} from './engine/state.ts';
export type { Fingerprint, State, StateResult } from './engine/state.ts';

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
