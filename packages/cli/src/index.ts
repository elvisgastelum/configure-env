// The programmatic API: load a schema, plan and apply its files, check them
// for drift, edit dotenv text, and read or write the protected variables'
// state. The CLI is built on the same functions, from @configure-env/core.
// See the README, "Programmatic API".

export {
  DEFAULT_SCHEMA_PATH,
  loadSchema,
  parseSchema,
  parseSchemaText,
} from '@configure-env/core';
export type { SchemaError, SchemaResult } from '@configure-env/core';

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
} from '@configure-env/core';
export type {
  Encoding,
  EnvSchema,
  FilePolicy,
  FileSpec,
  RuleField,
  VariableSpec,
  VariableType,
} from '@configure-env/core';

export {
  checkRules,
  formatValue,
  maskValue,
  ruleKeys,
  unquoteValue,
  validateValue,
} from '@configure-env/core';
export type {
  RuleProblem,
  ValueResult,
  VariableValue,
} from '@configure-env/core';

export { planChanges, validateValues } from '@configure-env/core';
export type {
  FileAction,
  FilePlan,
  Plan,
  PlanError,
  PlanOptions,
  ValueError,
} from '@configure-env/core';

export { applyPlan } from '@configure-env/core';
export type { ApplyFs, ApplyOptions, ApplyResult } from '@configure-env/core';

export {
  checkDrift,
  fileRules,
  protectedMismatches,
} from '@configure-env/core';
export type {
  CheckOptions,
  DriftReport,
  DriftStatus,
  FileDrift,
  InvalidValue,
  ProtectedMismatch,
} from '@configure-env/core';

export {
  DEFAULT_STATE_PATH,
  applyChanges,
  emptyState,
  fingerprint,
  loadState,
  matchesFingerprint,
  recordFingerprint,
  recorded,
  removeFingerprint,
  updateState,
  writeState,
} from '@configure-env/core';
export type {
  Fingerprint,
  State,
  StateChange,
  StateResult,
} from '@configure-env/core';

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
} from '@configure-env/core';
export type {
  DotenvDocument,
  DotenvLine,
  Eol,
  LineKind,
} from '@configure-env/core';

export { main } from './cli/main.ts';
export type { Io, Prompts } from './cli/io.ts';
