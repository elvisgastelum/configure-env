import { describe, expect, it } from 'vite-plus/test';
import type { SchemaDocument } from './document.ts';
import {
  FULL,
  TYPES,
  baseDocument,
  edited,
  refused,
} from './fixtures.test-helpers.ts';
import { formatJson } from './format.ts';
import { renameVariable } from './rename.ts';
import { addVariable } from './variables.ts';

/** A document where every kind of reference names OTHER and NET. */
function referencing(): SchemaDocument {
  const document = baseDocument();
  document.variables = {
    NET: { type: 'cidr' },
    FIRST: { type: 'string', requiredUnless: 'OTHER' },
    OTHER: { type: 'string', description: 'renamed' },
    ADDR: {
      type: 'ipv4',
      within: 'NET',
      requiredUnless: ['FIRST', 'OTHER'],
      conflictsWith: 'OTHER',
      distinctFrom: ['OTHER'],
    },
  };
  document.files = [
    { path: '.env', policy: 'generate', variables: '*' },
    {
      path: '.env.example',
      policy: 'generate',
      variables: ['FIRST', 'OTHER', 'NET'],
      values: { FIRST: 'a', OTHER: 'b', NET: '10.0.0.0/8' },
      comments: { OTHER: 'c', FIRST: 'd' },
    },
  ];
  return document;
}

describe('renameVariable', () => {
  it('renames the variable in place and rewrites every reference to it', () => {
    const document = referencing();
    const renamed = edited(renameVariable(document, 'OTHER', 'SECOND'));
    expect(Object.keys(renamed.variables)).toEqual([
      'NET',
      'FIRST',
      'SECOND',
      'ADDR',
    ]);
    expect(renamed.variables.SECOND).toEqual({
      type: 'string',
      description: 'renamed',
    });
    expect(renamed.variables.FIRST).toEqual({
      type: 'string',
      requiredUnless: 'SECOND',
    });
    expect(renamed.variables.ADDR).toEqual({
      type: 'ipv4',
      within: 'NET',
      requiredUnless: ['FIRST', 'SECOND'],
      conflictsWith: 'SECOND',
      distinctFrom: ['SECOND'],
    });
    expect(renamed.files[1]).toEqual({
      path: '.env.example',
      policy: 'generate',
      variables: ['FIRST', 'SECOND', 'NET'],
      values: { FIRST: 'a', SECOND: 'b', NET: '10.0.0.0/8' },
      comments: { SECOND: 'c', FIRST: 'd' },
    });
    // Key order inside `values` and `comments` is kept.
    expect(Object.keys(renamed.files[1]?.values ?? {})).toEqual([
      'FIRST',
      'SECOND',
      'NET',
    ]);
    expect(document).toEqual(referencing());
  });

  it('rewrites `within` when the cidr variable is renamed', () => {
    const renamed = edited(renameVariable(referencing(), 'NET', 'SUBNET'));
    expect(renamed.variables.ADDR).toMatchObject({ within: 'SUBNET' });
    expect(renamed.files[1]?.variables).toEqual(['FIRST', 'OTHER', 'SUBNET']);
    expect(renamed.files[1]?.values).toHaveProperty('SUBNET', '10.0.0.0/8');
  });

  it.each(TYPES)(
    'renames a %s variable with every option, and the variable its rules name',
    (type) => {
      const document = edited(addVariable(baseDocument(), 'NEW', FULL[type]));
      const renamed = edited(renameVariable(document, 'NEW', 'RENAMED'));
      expect(renamed.variables.RENAMED).toEqual(FULL[type]);
      expect(renamed.variables).not.toHaveProperty('NEW');
      const target = edited(renameVariable(document, 'OTHER', 'TARGET'));
      expect(target.variables.NEW).toMatchObject({
        requiredUnless: 'TARGET',
        conflictsWith: ['TARGET'],
        distinctFrom: 'TARGET',
      });
    },
  );

  it('keeps the text of the renamed variable when written back', () => {
    const document = referencing();
    const previous = formatJson(document);
    const text = formatJson(
      edited(renameVariable(document, 'NET', 'SUBNET')),
      previous,
    );
    expect(text).toBe(previous.replaceAll('"NET"', '"SUBNET"'));
  });

  it('refuses a variable that is not declared', () => {
    expect(refused(renameVariable(referencing(), 'NOPE', 'X'))).toEqual([
      { path: 'variables.NOPE', message: 'NOPE is not declared' },
    ]);
  });

  it('refuses a name that is already declared', () => {
    expect(refused(renameVariable(referencing(), 'OTHER', 'FIRST'))).toEqual([
      { path: 'variables.FIRST', message: 'FIRST is already declared' },
    ]);
  });

  it('refuses a name that is not a variable name', () => {
    expect(
      refused(renameVariable(referencing(), 'OTHER', 'NOT-OK')).map(
        (e) => e.path,
      ),
    ).toContain('variables["NOT-OK"]');
  });

  it('leaves the document as it is when the name does not change', () => {
    expect(edited(renameVariable(referencing(), 'OTHER', 'OTHER'))).toEqual(
      referencing(),
    );
  });
});
