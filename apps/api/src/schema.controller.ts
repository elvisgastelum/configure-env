// The schema writes over src/schema.ts: variables, files, init, and the
// whole document at once.

import {
  Body,
  Controller,
  Delete,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  applyDecorators,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiParam,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import {
  type FileInput,
  type VariableInput,
  addFile,
  addVariable,
  removeFile,
  removeVariable,
  renameVariable,
  reorderVariables,
  updateFile,
  updateVariable,
} from '@configure-env/core';
import type { z } from 'zod';
import {
  addFileRequest,
  addVariableRequest,
  errorResponse,
  initSchemaRequest,
  removeFileRequest,
  removeVariableRequest,
  renameVariableRequest,
  reorderVariablesRequest,
  replaceSchemaRequest,
  schemaEditRefusedResponse,
  schemaUnmaskRefusedResponse,
  schemaResponse,
  staleSchemaResponse,
  updateFileRequest,
  updateVariableRequest,
} from './contracts.ts';
import { CLIENT_HEADER, PROJECT, Read, actorOf, ref } from './http.ts';
import type { Project } from './project.ts';
import {
  editSchema,
  initSchema,
  replaceSchema,
  variableName,
} from './schema.ts';

/** A schema write: its body, its 200 (the new schema) and its refusals. */
const Write = (operationId: string, summary: string, body: z.ZodType) =>
  applyDecorators(
    HttpCode(200),
    Read(operationId, summary, schemaResponse),
    ApiBody({ schema: ref(body) }),
    ApiConflictResponse({
      description:
        'The schema changed since the fingerprint was read; nothing was written.',
      schema: ref(staleSchemaResponse),
    }),
    ApiUnprocessableEntityResponse({
      description:
        'The edit would make the schema invalid, or the schema is invalid now; nothing was written. The errors carry JSON paths.',
      schema: ref(schemaEditRefusedResponse),
    }),
  );

const Name = () =>
  applyDecorators(
    ApiParam({ name: 'name', description: 'The variable name.' }),
    ApiBadRequestResponse({
      description: 'Not a variable name, or an invalid body.',
      schema: ref(errorResponse),
    }),
  );

@ApiTags('schema')
@Controller('api/schema')
export class SchemaController {
  constructor(@Inject(PROJECT) private readonly project: Project) {}

  @Post('variables')
  @Write('addVariable', 'Declares a variable', addVariableRequest)
  addVariable(
    @Body({ schema: addVariableRequest })
    body: z.output<typeof addVariableRequest>,
  ) {
    return editSchema(this.project, body.fingerprint, (document) =>
      addVariable(document, body.name, body.spec as VariableInput, {
        files: body.files ?? [],
      }),
    );
  }

  @Put('variables/:name')
  @Write('updateVariable', "Changes a variable's fields", updateVariableRequest)
  @Name()
  updateVariable(
    @Param('name') name: string,
    @Body({ schema: updateVariableRequest })
    body: z.output<typeof updateVariableRequest>,
  ) {
    variableName(name);
    return editSchema(this.project, body.fingerprint, (document) =>
      updateVariable(document, name, body.changes),
    );
  }

  @Delete('variables/:name')
  @Write(
    'removeVariable',
    'Removes a variable; with cleanup, every reference to it too',
    removeVariableRequest,
  )
  @Name()
  removeVariable(
    @Param('name') name: string,
    @Body({ schema: removeVariableRequest })
    body: z.output<typeof removeVariableRequest>,
  ) {
    variableName(name);
    return editSchema(this.project, body.fingerprint, (document) =>
      removeVariable(document, name, { cleanup: Boolean(body.cleanup) }),
    );
  }

  @Post('variables/:name/rename')
  @Write(
    'renameVariable',
    'Renames a variable and every reference to it',
    renameVariableRequest,
  )
  @Name()
  renameVariable(
    @Param('name') name: string,
    @Body({ schema: renameVariableRequest })
    body: z.output<typeof renameVariableRequest>,
  ) {
    variableName(name);
    return editSchema(this.project, body.fingerprint, (document) =>
      renameVariable(document, name, body.to),
    );
  }

  @Put('variable-order')
  @Write(
    'reorderVariables',
    'Puts the variables in a new order',
    reorderVariablesRequest,
  )
  reorderVariables(
    @Body({ schema: reorderVariablesRequest })
    body: z.output<typeof reorderVariablesRequest>,
  ) {
    return editSchema(this.project, body.fingerprint, (document) =>
      reorderVariables(document, body.order),
    );
  }

  @Post('files')
  @Write('addFile', 'Adds a file the schema manages', addFileRequest)
  addFile(
    @Body({ schema: addFileRequest }) body: z.output<typeof addFileRequest>,
  ) {
    return editSchema(this.project, body.fingerprint, (document) =>
      addFile(
        document,
        body.spec as FileInput,
        body.index === undefined ? {} : { index: body.index },
      ),
    );
  }

  @Put('files')
  @Write('updateFile', "Changes a file's fields", updateFileRequest)
  updateFile(
    @Body({ schema: updateFileRequest })
    body: z.output<typeof updateFileRequest>,
  ) {
    return editSchema(this.project, body.fingerprint, (document) =>
      updateFile(document, body.path, body.changes),
    );
  }

  @Delete('files')
  @Write(
    'removeFile',
    'Removes a file from the schema; its variables stay declared',
    removeFileRequest,
  )
  removeFile(
    @Body({ schema: removeFileRequest })
    body: z.output<typeof removeFileRequest>,
  ) {
    return editSchema(this.project, body.fingerprint, (document) =>
      removeFile(document, body.path),
    );
  }

  @Post('init')
  @Write(
    'initSchema',
    'Writes a starting schema, inferred from an example env file, as configure-env init does',
    initSchemaRequest,
  )
  init(
    @Body({ schema: initSchemaRequest })
    body: z.output<typeof initSchemaRequest>,
    @Headers(CLIENT_HEADER) client?: string,
  ) {
    return initSchema(this.project, body, actorOf(client));
  }

  @Put()
  @Write(
    'replaceSchema',
    'Replaces the whole schema document, against its fingerprint',
    replaceSchemaRequest,
  )
  @ApiBadRequestResponse({
    description: 'An invalid body.',
    schema: ref(errorResponse),
  })
  @ApiForbiddenResponse({
    description:
      'With keepSecretsMasked: the document would show a hidden value; nothing was written.',
    schema: ref(schemaUnmaskRefusedResponse),
  })
  replace(
    @Body({ schema: replaceSchemaRequest })
    body: z.output<typeof replaceSchemaRequest>,
    @Headers(CLIENT_HEADER) client?: string,
  ) {
    return replaceSchema(this.project, body, actorOf(client));
  }
}
