import { describe, expect, it } from 'vite-plus/test';
import { FILE_POLICIES } from '../schema/definition.ts';
import type { FileInput } from './document.ts';
import { addFile, removeFile, updateFile } from './files.ts';
import { baseDocument, edited, refused } from './fixtures.test-helpers.ts';

/** A file with every option set. */
const FULL_FILE: FileInput = {
  path: 'config/.env.local',
  policy: 'merge',
  variables: ['OTHER', 'NET'],
  mode: '600',
  header: 'Local settings.\nNot committed.',
  description: 'For local development',
  template: true,
  values: { OTHER: 'change-me', NET: '10.0.0.0/8' },
  comments: { NET: 'The private network' },
};

describe('addFile', () => {
  it.each(FILE_POLICIES)('adds a %s file with every option', (policy) => {
    const document = baseDocument();
    const added = edited(addFile(document, { ...FULL_FILE, policy }));
    expect(added.files.at(-1)).toEqual({ ...FULL_FILE, policy });
    expect(added.files).toHaveLength(3);
    expect(document).toEqual(baseDocument());
  });

  it('adds a file that takes every variable', () => {
    const file: FileInput = {
      path: '.env.ci',
      policy: 'generate',
      variables: '*',
    };
    expect(edited(addFile(baseDocument(), file)).files[2]).toEqual(file);
  });

  it('puts the file at the index given', () => {
    const file: FileInput = {
      path: '.env.ci',
      policy: 'generate',
      variables: '*',
    };
    const added = edited(addFile(baseDocument(), file, { index: 0 }));
    expect(added.files.map((f) => f.path)).toEqual([
      '.env.ci',
      '.env',
      '.env.example',
    ]);
  });

  it.each<[FileInput, string]>([
    [{ ...FULL_FILE, path: '.env' }, 'files[2].path'],
    [{ ...FULL_FILE, path: '../.env' }, 'files[2].path'],
    [{ ...FULL_FILE, mode: '9' }, 'files[2].mode'],
    [{ ...FULL_FILE, variables: ['MISSING'] }, 'files[2].variables[0]'],
    [{ ...FULL_FILE, variables: ['OTHER'] }, 'files[2].values.NET'],
    [{ ...FULL_FILE, values: { OTHER: 'a\nb' } }, 'files[2].values.OTHER'],
  ])('reports what parseSchema finds wrong: %j', (file, path) => {
    expect(refused(addFile(baseDocument(), file)).map((e) => e.path)).toContain(
      path,
    );
  });
});

describe('updateFile', () => {
  it('sets every option of a file, then clears the optional ones', () => {
    const { path, policy, variables, ...options } = FULL_FILE;
    const document = edited(
      addFile(baseDocument(), { path, policy, variables }),
    );
    const full = edited(updateFile(document, path, options));
    expect(full.files[2]).toEqual(FULL_FILE);
    const cleared = Object.fromEntries(
      Object.keys(options).map((key) => [key, null]),
    );
    expect(edited(updateFile(full, path, cleared)).files[2]).toEqual({
      path,
      policy,
      variables,
    });
  });

  it.each(FILE_POLICIES)('changes the policy to %s', (policy) => {
    expect(
      edited(updateFile(baseDocument(), '.env', { policy })).files[0],
    ).toEqual({ path: '.env', policy, variables: '*' });
  });

  it('changes the path, keeping the field order', () => {
    const updated = edited(
      updateFile(baseDocument(), '.env.example', {
        path: '.env.sample',
        variables: '*',
      }),
    );
    expect(Object.entries(updated.files[1] ?? {})).toEqual([
      ['path', '.env.sample'],
      ['policy', 'generate'],
      ['variables', '*'],
      ['values', { OTHER: 'placeholder' }],
    ]);
  });

  it('refuses a file that is not in the schema', () => {
    expect(
      refused(updateFile(baseDocument(), 'nope', { mode: '600' })),
    ).toEqual([{ path: 'files', message: 'nope is not a file of the schema' }]);
  });

  it('refuses removing a field every file needs', () => {
    expect(
      refused(updateFile(baseDocument(), '.env', { policy: null })).map(
        (e) => e.path,
      ),
    ).toEqual(['files[0].policy']);
  });

  it('refuses a variable list that leaves `values` behind', () => {
    expect(
      refused(updateFile(baseDocument(), '.env.example', { variables: [] })),
    ).toEqual([
      {
        path: 'files[1].values.OTHER',
        message: "OTHER is not one of this file's variables",
      },
    ]);
  });
});

describe('removeFile', () => {
  it('removes the file', () => {
    const removed = edited(removeFile(baseDocument(), '.env'));
    expect(removed.files.map((f) => f.path)).toEqual(['.env.example']);
  });

  it('refuses a file that is not in the schema', () => {
    expect(refused(removeFile(baseDocument(), 'nope'))).toEqual([
      { path: 'files', message: 'nope is not a file of the schema' },
    ]);
  });
});
