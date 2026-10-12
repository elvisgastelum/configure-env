// The value writes over src/values.ts: set (or generate) and unset keys of
// one schema file.

import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  applyDecorators,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { z } from 'zod';
import {
  editRefusedResponse,
  errorResponse,
  setValuesRequest,
  staleFileResponse,
  unsetValuesRequest,
  valuesResponse,
} from './contracts.ts';
import { PROJECT, Read, ref, requireSchema } from './http.ts';
import type { Project } from './project.ts';
import { setFileValues, unsetFileValues } from './values.ts';

/** The answers every value write may give besides its 200. */
const ValueWrite = () =>
  applyDecorators(
    ApiNotFoundResponse({
      description: 'Not a schema file.',
      schema: ref(errorResponse),
    }),
    ApiForbiddenResponse({
      description: 'The file path is refused: it leaves the root.',
      schema: ref(errorResponse),
    }),
    ApiConflictResponse({
      description:
        'The file changed since the fingerprint was read; nothing was written.',
      schema: ref(staleFileResponse),
    }),
    ApiUnprocessableEntityResponse({
      description:
        'Values that break their rules, or protected values the edit may not change; nothing was written. Also an invalid schema.',
      schema: ref(editRefusedResponse),
    }),
    ApiServiceUnavailableResponse({
      description:
        'The protected state cannot be read or used; nothing was written.',
      schema: ref(errorResponse),
    }),
  );

@ApiTags('values')
@Controller('api/values')
export class ValuesController {
  constructor(@Inject(PROJECT) private readonly project: Project) {}

  @Post('set')
  @HttpCode(200)
  @Read(
    'setValues',
    'Sets values in one file, given or generated; protected values only when replaced by key',
    valuesResponse,
  )
  @ApiBody({ schema: ref(setValuesRequest) })
  @ValueWrite()
  async set(
    @Body({ schema: setValuesRequest })
    body: z.output<typeof setValuesRequest>,
  ) {
    return setFileValues(await requireSchema(this.project), this.project, body);
  }

  @Post('unset')
  @HttpCode(200)
  @Read(
    'unsetValues',
    'Removes keys from one file; protected values only when replaced by key',
    valuesResponse,
  )
  @ApiBody({ schema: ref(unsetValuesRequest) })
  @ValueWrite()
  async unset(
    @Body({ schema: unsetValuesRequest })
    body: z.output<typeof unsetValuesRequest>,
  ) {
    return unsetFileValues(
      await requireSchema(this.project),
      this.project,
      body,
    );
  }
}
