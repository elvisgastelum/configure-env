import { parseSchema } from '@configure-env/core/schema';
import type { SchemaDocument } from '@configure-env/core/schema';
import { describe, expect, it } from 'vite-plus/test';
import { schemaDocument, typedSchemaVariables } from '../../mocks/fixtures';
import { mockState } from '../../mocks/store';
import { recordRequests } from '../../test/requests';
import { HttpResponse, http } from 'msw';
import { server } from '../../test/server';
import {
  previewEdit,
  refusedErrors,
  sendEdit,
  staleSchema,
  validDocument,
  writtenBeforeFailure,
} from './edits';

const recordWrites = () => recordRequests('/api/schema/');

describe('the sample schema', () => {
  it('is valid, with and without the extra typed variables', () => {
    expect(parseSchema(schemaDocument).ok).toBe(true);
    expect(
      parseSchema({
        ...schemaDocument,
        variables: { ...schemaDocument.variables, ...typedSchemaVariables },
      }).ok,
    ).toBe(true);
  });
});

describe('previewEdit', () => {
  it('changes a variable and renames it in one preview', () => {
    const result = previewEdit(schemaDocument, {
      kind: 'updateVariable',
      name: 'API_KEY',
      changes: { description: 'The partner key.' },
      rename: 'PARTNER_KEY',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.variables.PARTNER_KEY?.description).toBe(
      'The partner key.',
    );
    // DB_PASSWORD's distinctFrom named it, and follows the rename.
    expect(result.document.variables.DB_PASSWORD).toMatchObject({
      distinctFrom: 'PARTNER_KEY',
    });
  });

  it('refuses an edit the schema does not allow, with its path', () => {
    const result = previewEdit(schemaDocument, {
      kind: 'updateVariable',
      name: 'DB_PASSWORD',
      changes: { secret: false },
    });
    expect(result).toEqual({
      ok: false,
      errors: [
        {
          path: 'variables.DB_PASSWORD.protected',
          message: 'protected needs secret: true',
        },
      ],
    });
  });

  it('never changes the document it is given', () => {
    const before = structuredClone(schemaDocument);
    previewEdit(schemaDocument, { kind: 'removeFile', path: '.env' });
    expect(schemaDocument).toEqual(before);
  });
});

describe('sendEdit', () => {
  it('sends a change, then the rename against the new fingerprint', async () => {
    const writes = recordWrites();
    const schema = await sendEdit(
      {
        kind: 'updateVariable',
        name: 'PORT',
        changes: { default: 8080 },
        rename: 'HTTP_PORT',
      },
      'schema-1',
    );
    expect(writes).toEqual([
      [
        'PUT',
        '/api/schema/variables/PORT',
        { fingerprint: 'schema-1', changes: { default: 8080 } },
      ],
      [
        'POST',
        '/api/schema/variables/PORT/rename',
        { fingerprint: 'schema-2', to: 'HTTP_PORT' },
      ],
    ]);
    expect(schema.fingerprint).toBe('schema-3');
    expect(
      (validDocument(schema) as SchemaDocument).variables.HTTP_PORT,
    ).toMatchObject({ default: 8080 });
  });

  it('sends only the rename when nothing else changed', async () => {
    const writes = recordWrites();
    await sendEdit(
      { kind: 'updateVariable', name: 'PORT', changes: {}, rename: 'P' },
      'schema-1',
    );
    expect(writes).toEqual([
      [
        'POST',
        '/api/schema/variables/PORT/rename',
        { fingerprint: 'schema-1', to: 'P' },
      ],
    ]);
  });

  describe('when the rename fails after the change was written', () => {
    const changeAndRename = (to: string) =>
      sendEdit(
        {
          kind: 'updateVariable',
          name: 'PORT',
          changes: { default: 8080 },
          rename: to,
        },
        'schema-1',
      ).catch((caught: unknown) => caught);

    it('reports the schema the change wrote and the refused rename', async () => {
      // Another variable took the name between the preview and the write.
      const error = await changeAndRename('API_KEY');
      const written = writtenBeforeFailure(error);
      expect(written?.fingerprint).toBe('schema-2');
      expect(
        (validDocument(written) as SchemaDocument).variables.PORT,
      ).toMatchObject({ default: 8080 });
      expect(mockState.schema.fingerprint).toBe('schema-2');
      expect(refusedErrors(error)).toEqual([
        expect.objectContaining({ path: expect.stringContaining('API_KEY') }),
      ]);
    });

    it('reports a stale rename with the schema as it is now', async () => {
      server.use(
        http.post('/api/schema/variables/:name/rename', () =>
          HttpResponse.json(
            { statusCode: 409, message: 'changed', schema: mockState.schema },
            { status: 409 },
          ),
        ),
      );
      const error = await changeAndRename('HTTP_PORT');
      expect(writtenBeforeFailure(error)?.fingerprint).toBe('schema-2');
      expect(staleSchema(error)?.fingerprint).toBe('schema-2');
    });

    it('reports a rename lost to the network with its message', async () => {
      server.use(
        http.post('/api/schema/variables/:name/rename', () =>
          HttpResponse.error(),
        ),
      );
      const error = await changeAndRename('HTTP_PORT');
      expect(writtenBeforeFailure(error)?.fingerprint).toBe('schema-2');
      expect(refusedErrors(error)).toBeUndefined();
      expect(staleSchema(error)).toBeUndefined();
      expect((error as Error).message).not.toBe('');
    });
  });

  it('reports nothing written when a single write fails', async () => {
    const error = await sendEdit(
      { kind: 'removeFile', path: '.env' },
      'schema-0',
    ).catch((caught: unknown) => caught);
    expect(writtenBeforeFailure(error)).toBeUndefined();
  });

  it('reports a stale fingerprint with the schema as it is now', async () => {
    const error = await sendEdit(
      { kind: 'removeFile', path: '.env' },
      'schema-0',
    ).catch((caught: unknown) => caught);
    expect(staleSchema(error)).toEqual(mockState.schema);
    expect(refusedErrors(error)).toBeUndefined();
  });

  it('reports a refused edit with its errors', async () => {
    const error = await sendEdit(
      { kind: 'removeVariable', name: 'DB_PASSWORD', cleanup: false },
      'schema-1',
    ).catch((caught: unknown) => caught);
    expect(refusedErrors(error)).toEqual([
      {
        path: 'variables.API_KEY.requiredUnless[0]',
        message:
          'names DB_PASSWORD; remove the reference first, or clean it up',
      },
      {
        path: 'files[1].variables[2]',
        message:
          'names DB_PASSWORD; remove the reference first, or clean it up',
      },
      {
        path: 'files[1].values.DB_PASSWORD',
        message:
          'names DB_PASSWORD; remove the reference first, or clean it up',
      },
    ]);
  });
});
