import { describe, expect, it } from 'vitest';
import type { VariableInput } from './document.ts';
import {
  FULL,
  TYPES,
  baseDocument,
  edited,
  refused,
} from './fixtures.test-helpers.ts';
import {
  addVariable,
  removeVariable,
  reorderVariables,
  updateVariable,
} from './variables.ts';
import { variableReferences } from './references.ts';

const withNew = (spec = FULL.string) =>
  edited(addVariable(baseDocument(), 'NEW', spec));

describe('addVariable', () => {
  it.each(TYPES)('adds a %s variable with every option it takes', (type) => {
    const document = baseDocument();
    const result = addVariable(document, 'NEW', FULL[type]);
    const added = edited(result);
    expect(added.variables.NEW).toEqual(FULL[type]);
    expect(Object.keys(added.variables)).toEqual(['NET', 'OTHER', 'NEW']);
    expect(result.ok && result.schema.variables.NEW?.type).toBe(type);
    // Pure: the input is left as it was.
    expect(document).toEqual(baseDocument());
  });

  it('adds the variable to the files named, after their variables', () => {
    const added = edited(
      addVariable(
        baseDocument(),
        'NEW',
        { type: 'port' },
        {
          files: ['.env.example', '.env'],
        },
      ),
    );
    expect(added.files[1]?.variables).toEqual(['OTHER', 'NEW']);
    expect(added.files[0]?.variables).toBe('*');
  });

  it('refuses a file that is not in the schema', () => {
    expect(
      refused(
        addVariable(
          baseDocument(),
          'NEW',
          { type: 'port' },
          {
            files: ['.env.local'],
          },
        ),
      ),
    ).toEqual([
      { path: 'files', message: '.env.local is not a file of the schema' },
    ]);
  });

  it('refuses a name that is already declared', () => {
    expect(
      refused(addVariable(baseDocument(), 'OTHER', { type: 'port' })),
    ).toEqual([
      { path: 'variables.OTHER', message: 'OTHER is already declared' },
    ]);
  });

  it('reports what parseSchema finds wrong with the new variable', () => {
    const errors = refused(
      addVariable(baseDocument(), '1BAD', { type: 'port' }),
    );
    expect(errors.map((e) => e.path)).toEqual(['variables["1BAD"]']);
  });

  it.each<[VariableInput, string]>([
    [{ type: 'port', default: 70000 }, 'variables.NEW.default'],
    [{ type: 'string', protected: true }, 'variables.NEW.protected'],
    [{ type: 'ipv4', within: 'OTHER' }, 'variables.NEW.within'],
    [
      { type: 'string', conflictsWith: ['MISSING'] },
      'variables.NEW.conflictsWith[0]',
    ],
    [
      { type: 'string', required: true, requiredUnless: 'OTHER' },
      'variables.NEW.requiredUnless',
    ],
  ])('runs the cross-field checks: %j', (spec, path) => {
    expect(
      refused(addVariable(baseDocument(), 'NEW', spec)).map((e) => e.path),
    ).toContain(path);
  });
});

describe('updateVariable', () => {
  it.each(TYPES)(
    'sets every option of a %s variable, then clears them',
    (type) => {
      const options: Record<string, unknown> = { ...FULL[type] };
      delete options.type;
      // An enum needs its values to be valid at all.
      const bare = (
        type === 'enum' ? { type, values: ['a', 'b'] } : { type }
      ) as VariableInput;
      const minimal = edited(addVariable(baseDocument(), 'NEW', bare));
      const full = edited(updateVariable(minimal, 'NEW', options));
      expect(full.variables.NEW).toEqual(FULL[type]);
      const cleared = Object.fromEntries(
        Object.keys(options)
          .filter((key) => key !== 'values')
          .map((key) => [key, null]),
      );
      expect(
        edited(updateVariable(full, 'NEW', cleared)).variables.NEW,
      ).toEqual(bare);
    },
  );

  // Removing these alone leaves another option that needs them.
  const needed: Record<string, string> = {
    secret: 'variables.NEW.protected',
    encoding: 'variables.NEW.bytes',
    values: 'variables.NEW.values',
  };

  it.each(TYPES)('removes each option of a %s variable on its own', (type) => {
    const full = withNew(FULL[type]);
    for (const field of Object.keys(FULL[type]).filter(
      (key) => key !== 'type',
    )) {
      const result = updateVariable(full, 'NEW', { [field]: undefined });
      if (needed[field])
        expect(
          refused(result).map((e) => e.path),
          field,
        ).toContain(needed[field]);
      else
        expect(edited(result).variables.NEW, field).not.toHaveProperty(field);
    }
  });

  it('keeps the position of fields it changes and appends new ones', () => {
    const document = withNew({ type: 'port', description: 'x', default: 1 });
    const updated = edited(
      updateVariable(document, 'NEW', {
        default: 2,
        group: 'g',
        description: 'y',
      }),
    );
    expect(Object.entries(updated.variables.NEW ?? {})).toEqual([
      ['type', 'port'],
      ['description', 'y'],
      ['default', 2],
      ['group', 'g'],
    ]);
  });

  it('drops the options the new type does not take when the type changes', () => {
    const document = withNew(FULL.cidr);
    const updated = edited(
      updateVariable(document, 'NEW', {
        type: 'ipv4',
        default: null,
        example: null,
      }),
    );
    expect(updated.variables.NEW).not.toHaveProperty('family');
    expect(updated.variables.NEW).not.toHaveProperty('strict');
    expect(updated.variables.NEW).toMatchObject({
      type: 'ipv4',
      within: 'NET',
    });
  });

  it('reports an option the type does not take when the type stays', () => {
    expect(
      refused(updateVariable(withNew({ type: 'port' }), 'NEW', { min: 1 })).map(
        (e) => e.path,
      ),
    ).toEqual(['variables.NEW']);
  });

  it('refuses a variable that is not declared', () => {
    expect(
      refused(updateVariable(baseDocument(), 'NOPE', { default: 'x' })),
    ).toEqual([{ path: 'variables.NOPE', message: 'NOPE is not declared' }]);
  });

  it('does not let changes rename the variable', () => {
    expect(refused(updateVariable(withNew(), 'NEW', { name: 'X' }))).toEqual([
      expect.objectContaining({ path: 'variables.NEW' }),
    ]);
  });

  it('refuses a protected variable that stops being secret', () => {
    expect(
      refused(updateVariable(withNew(), 'NEW', { secret: false })).map(
        (e) => e.message,
      ),
    ).toContain('protected needs secret: true');
  });
});

describe('variableReferences', () => {
  it('finds every rule and file that names the variable', () => {
    const document = withNew({
      type: 'string',
      requiredUnless: ['NET', 'OTHER'],
      conflictsWith: 'OTHER',
    });
    expect(variableReferences(document, 'OTHER')).toEqual([
      'variables.NEW.requiredUnless[1]',
      'variables.NEW.conflictsWith',
      'files[1].variables[0]',
      'files[1].values.OTHER',
    ]);
  });
});

describe('removeVariable', () => {
  it('removes a variable nothing refers to', () => {
    const removed = edited(removeVariable(withNew({ type: 'port' }), 'NEW'));
    expect(removed).toEqual(baseDocument());
  });

  it('reports dangling references instead of breaking the schema', () => {
    const document = withNew({
      type: 'ipv4',
      within: 'NET',
      distinctFrom: ['OTHER'],
    });
    expect(refused(removeVariable(document, 'OTHER'))).toEqual([
      {
        path: 'variables.NEW.distinctFrom[0]',
        message: 'names OTHER; remove the reference first, or clean it up',
      },
      {
        path: 'files[1].variables[0]',
        message: 'names OTHER; remove the reference first, or clean it up',
      },
      {
        path: 'files[1].values.OTHER',
        message: 'names OTHER; remove the reference first, or clean it up',
      },
    ]);
  });

  it('cleans the references up when asked', () => {
    const document = edited(
      addVariable(
        withNew({ type: 'ipv4', within: 'NET', distinctFrom: ['OTHER'] }),
        'B',
        {
          type: 'string',
          requiredUnless: ['OTHER', 'NEW'],
          conflictsWith: 'OTHER',
        },
      ),
    );
    document.files[1] = {
      ...document.files[1]!,
      variables: ['OTHER', 'NEW'],
      values: { OTHER: 'x', NEW: '10.0.0.9' },
      comments: { OTHER: 'gone' },
    };
    const removed = edited(
      removeVariable(document, 'OTHER', { cleanup: true }),
    );
    expect(removed.variables).toEqual({
      NET: { type: 'cidr' },
      NEW: { type: 'ipv4', within: 'NET' },
      B: { type: 'string', requiredUnless: ['NEW'] },
    });
    expect(removed.files[1]).toEqual({
      path: '.env.example',
      policy: 'generate',
      variables: ['NEW'],
      values: { NEW: '10.0.0.9' },
    });
  });

  it('refuses a variable that is not declared', () => {
    expect(refused(removeVariable(baseDocument(), 'NOPE'))).toEqual([
      { path: 'variables.NOPE', message: 'NOPE is not declared' },
    ]);
  });
});

describe('reorderVariables', () => {
  it('puts the variables in the order given', () => {
    const reordered = edited(
      reorderVariables(withNew(), ['NEW', 'NET', 'OTHER']),
    );
    expect(Object.keys(reordered.variables)).toEqual(['NEW', 'NET', 'OTHER']);
    expect(reordered.variables.NEW).toEqual(FULL.string);
  });

  it('needs every declared variable exactly once', () => {
    expect(
      refused(reorderVariables(withNew(), ['NEW', 'NEW', 'NOPE'])),
    ).toEqual([
      { path: 'variables', message: 'NEW is listed twice' },
      { path: 'variables', message: 'NOPE is not declared' },
      { path: 'variables', message: 'NET is missing from the order' },
      { path: 'variables', message: 'OTHER is missing from the order' },
    ]);
  });
});
