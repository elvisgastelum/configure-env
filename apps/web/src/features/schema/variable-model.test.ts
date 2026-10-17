import type { SchemaDocument } from '@configure-env/core/schema';
import { describe, expect, it } from 'vite-plus/test';
import { createI18n } from '../../i18n';
import { schemaDocument, typedSchemaVariables } from '../../mocks/fixtures';
import {
  EMPTY_VARIABLE,
  type VariableFormValues,
  droppedBySwitch,
  fieldForPath,
  fromSpec,
  specChanges,
  toSpec,
  typeFields,
  variableEdit,
  variableFormSchema,
} from './variable-model';

const { t } = createI18n('en');

const document: SchemaDocument = {
  ...schemaDocument,
  variables: { ...schemaDocument.variables, ...typedSchemaVariables },
};
const values = (overrides: Partial<VariableFormValues>) => ({
  ...EMPTY_VARIABLE,
  ...overrides,
});

describe('typeFields', () => {
  it('reads each type’s options from the core definitions', () => {
    expect(typeFields('string')).toEqual([
      'minLength',
      'maxLength',
      'pattern',
      'patternMessage',
      'encoding',
      'bytes',
    ]);
    expect(typeFields('integer')).toEqual(['min', 'max']);
    expect(typeFields('enum')).toEqual(['values']);
    expect(typeFields('url')).toEqual(['protocols']);
    expect(typeFields('ipv6')).toEqual(['within']);
    expect(typeFields('cidr')).toEqual(['within', 'family', 'strict']);
    for (const type of ['boolean', 'email', 'host', 'port'] as const)
      expect(typeFields(type)).toEqual([]);
  });
});

describe('fromSpec and toSpec', () => {
  it('round-trip every variable of the sample schema', () => {
    // Defaults are left out, and a one-name rule list is written as the name.
    const written = (value: unknown) =>
      Array.isArray(value) && value.length === 1 ? value[0] : value;
    for (const [name, spec] of Object.entries(document.variables))
      expect(toSpec(fromSpec(name, spec))).toEqual(
        Object.fromEntries(
          Object.entries(spec)
            .filter(([, value]) => value !== false && value !== 'any')
            .map(([field, value]) => [
              field,
              field === 'requiredUnless' ? written(value) : value,
            ]),
        ),
      );
  });

  it('types the default and example by the variable type', () => {
    expect(toSpec(values({ type: 'port', default: '8080' }))).toEqual({
      type: 'port',
      default: 8080,
    });
    expect(toSpec(values({ type: 'boolean', example: 'true' }))).toEqual({
      type: 'boolean',
      example: true,
    });
    expect(toSpec(values({ type: 'string', default: '42' }))).toEqual({
      type: 'string',
      default: '42',
    });
  });

  it('writes protected as true or with its reason', () => {
    expect(toSpec(values({ secret: true, protected: 'yes' }))).toMatchObject({
      protected: true,
    });
    expect(
      toSpec(
        values({ secret: true, protected: 'reason', protectedReason: 'Keys' }),
      ),
    ).toMatchObject({ protected: { reason: 'Keys' } });
  });

  it('keeps only the options of the current type', () => {
    expect(
      toSpec(values({ type: 'email', minLength: '3', within: 'X', min: '1' })),
    ).toEqual({ type: 'email' });
  });
});

describe('specChanges', () => {
  it('is empty for an untouched variable, whatever form its JSON takes', () => {
    for (const [name, spec] of Object.entries(document.variables))
      expect(specChanges(spec, toSpec(fromSpec(name, spec)))).toEqual({});
    expect(
      specChanges(
        { type: 'cidr', family: 'any', required: false },
        { type: 'cidr' },
      ),
    ).toEqual({});
  });

  it('sets what changed and removes what was cleared', () => {
    const spec = document.variables.API_KEY!;
    const next = toSpec({
      ...fromSpec('API_KEY', spec),
      description: '',
      requiredUnless: ['DB_PASSWORD', 'PORT'],
    });
    expect(specChanges(spec, next)).toEqual({
      description: null,
      requiredUnless: ['DB_PASSWORD', 'PORT'],
    });
  });
});

describe('variableEdit', () => {
  it('adds a variable to the files it joins', () => {
    expect(
      variableEdit(
        document,
        undefined,
        values({ name: 'NEW', files: ['config/app.env'] }),
      ),
    ).toEqual({
      kind: 'addVariable',
      name: 'NEW',
      spec: { type: 'string' },
      files: ['config/app.env'],
    });
  });

  it('changes and renames a variable', () => {
    expect(
      variableEdit(document, 'PORT', {
        ...fromSpec('PORT', document.variables.PORT!),
        name: 'HTTP_PORT',
        required: true,
      }),
    ).toEqual({
      kind: 'updateVariable',
      name: 'PORT',
      changes: { required: true },
      rename: 'HTTP_PORT',
    });
  });
});

describe('fieldForPath', () => {
  it.each([
    ['variables.X', 'name'],
    ['variables.X.minLength', 'minLength'],
    ['variables.X.requiredUnless[1]', 'requiredUnless'],
    ['variables.X.protected', 'protected'],
    ['variables.X.protected.reason', 'protectedReason'],
    ['variables.X.values', 'values'],
    ['variables.X.default', 'default'],
    ['files', 'files'],
    ['variables.OTHER.within', 'root'],
    ['version', 'root'],
    // Inherited properties are no form fields.
    ['variables.X.constructor', 'root'],
    ['variables.X.hasOwnProperty', 'root'],
  ])('puts %s on %s', (path, field) => {
    expect(fieldForPath(path, ['X'])).toBe(field);
  });
});

describe('variableFormSchema', () => {
  const check = (original: string | undefined, form: VariableFormValues) =>
    variableFormSchema(document, original, t).safeParse(form);
  const issues = (result: ReturnType<typeof check>) =>
    result.success
      ? []
      : result.error.issues.map((issue) => [issue.path[0], issue.message]);

  it('turns a valid form into its edit', () => {
    const result = check(undefined, values({ name: 'NEW', type: 'email' }));
    expect(result.success && result.data).toEqual({
      kind: 'addVariable',
      name: 'NEW',
      spec: { type: 'email' },
    });
  });

  it('refuses a name the schema cannot hold', () => {
    expect(issues(check(undefined, values({ name: '9LIVES' })))).toEqual([
      [
        'name',
        'must start with a letter or underscore and hold only letters, digits and underscores',
      ],
    ]);
    expect(issues(check(undefined, values({ name: 'PORT' })))).toEqual([
      ['name', 'PORT is already declared'],
    ]);
  });

  it('puts each core error on its field', () => {
    expect(
      issues(
        check(
          undefined,
          values({
            name: 'TOKEN',
            minLength: '10',
            maxLength: '2',
            pattern: '(',
            requiredUnless: ['TOKEN_2'],
            protected: 'yes',
          }),
        ),
      ),
    ).toEqual([
      ['pattern', 'pattern is not a valid regular expression'],
      ['minLength', 'minLength must not exceed maxLength'],
      ['requiredUnless', 'TOKEN_2 is not declared in variables'],
      ['protected', 'protected needs secret: true'],
    ]);
  });

  it('checks the default against the variable’s own rules', () => {
    expect(
      issues(
        check(undefined, values({ name: 'P', type: 'port', default: '99999' })),
      ),
    ).toEqual([['default', expect.stringMatching(/^invalid default: /)]]);
  });

  it('asks for whole numbers before asking the core', () => {
    expect(
      issues(check(undefined, values({ name: 'S', minLength: '1.5' }))),
    ).toEqual([['minLength', 'must be a whole number']]);
  });
});

describe('droppedBySwitch', () => {
  it('names the options the new type does not take', () => {
    const form = values({ type: 'string', minLength: '4', pattern: '^a' });
    expect(droppedBySwitch(form, 'email')).toEqual(['minLength', 'pattern']);
    expect(
      droppedBySwitch(values({ type: 'ipv4', within: 'N' }), 'cidr'),
    ).toEqual([]);
  });

  it('names a default that is no value of the new type', () => {
    expect(
      droppedBySwitch(values({ type: 'string', default: 'abc' }), 'port'),
    ).toEqual(['default']);
    expect(
      droppedBySwitch(values({ type: 'string', default: '80' }), 'port'),
    ).toEqual([]);
  });
});
