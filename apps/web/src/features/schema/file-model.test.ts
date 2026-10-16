import { describe, expect, it } from 'vitest';
import { schemaDocument } from '../../mocks/fixtures';
import {
  EMPTY_FILE,
  fileEdit,
  fileFieldForPath,
  fromFile,
  toFile,
} from './file-model';

describe('fromFile and toFile', () => {
  it('round-trip every file of the sample schema', () => {
    for (const file of schemaDocument.files)
      expect(toFile(fromFile(file))).toEqual(file);
  });
});

describe('fileEdit', () => {
  it('changes nothing for an untouched file', () => {
    const file = schemaDocument.files[1]!;
    expect(fileEdit(schemaDocument, file.path, fromFile(file))).toEqual({
      kind: 'updateFile',
      path: file.path,
      changes: {},
    });
  });

  it('removes what was cleared and renames by path', () => {
    const file = schemaDocument.files[1]!;
    expect(
      fileEdit(schemaDocument, file.path, {
        ...fromFile(file),
        path: '.env.sample',
        header: '',
        values: [],
      }),
    ).toEqual({
      kind: 'updateFile',
      path: '.env.example',
      changes: { path: '.env.sample', header: null, values: null },
    });
  });
});

describe('fileFieldForPath', () => {
  const values = {
    ...EMPTY_FILE,
    values: [
      { name: 'A', value: '' },
      { name: 'B', value: '' },
    ],
    comments: [{ name: 'B', comment: '' }],
  };
  it.each([
    ['files[2].path', 'path'],
    ['files[2].mode', 'mode'],
    ['files[2].variables[3]', 'variables'],
    ['files[2].values.B', 'values.1.value'],
    ['files[2].comments.B', 'comments.0.name'],
    ['files[2].values.Z', 'values'],
    ['files[1].path', 'root'],
    ['variables.A.type', 'root'],
  ])('puts %s on %s', (path, field) => {
    expect(fileFieldForPath(path, 2, values)).toBe(field);
  });
});
