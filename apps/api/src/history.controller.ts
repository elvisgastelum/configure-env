// The history of edits over src/history.ts: a filtered page of changes, and
// undoing one.

import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  applyDecorators,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiParam,
  ApiQuery,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
  ApiBadRequestResponse,
} from '@nestjs/swagger';
import type { z } from 'zod';
import {
  errorResponse,
  historyQuery,
  historyResponse,
  undoConflictResponse,
  undoRefusedResponse,
  undoResponse,
} from './contracts.ts';
import { ApiError, PROJECT, Read, ref } from './http.ts';
import { readHistory, undoHistoryChange } from './history.ts';
import type { Project } from './project.ts';

const StateUnavailable = () =>
  ApiServiceUnavailableResponse({
    description: 'The state database cannot be read or written.',
    schema: ref(errorResponse),
  });

/** The query parameters Swagger cannot find without emitted metadata. */
const QUERY = [
  ['file', 'Only the changes to this file (or the schema file).'],
  ['key', 'Only the changes to this variable; empty for the schema changes.'],
  ['actor', 'Only the changes made by the cli or the portal.'],
  ['from', 'From this date (YYYY-MM-DD, UTC) or ISO timestamp.'],
  ['to', 'Up to this date (its whole UTC day) or ISO timestamp, included.'],
  ['page', 'The page, from 1.'],
  ['limit', 'The changes per page, 1 to 200; 50 by default.'],
] as const;

const HistoryQuery = () =>
  applyDecorators(
    ...QUERY.map(([name, description]) =>
      ApiQuery({
        name,
        required: false,
        description,
        ...(name === 'actor' ? { enum: ['cli', 'portal'] } : {}),
        type: name === 'page' || name === 'limit' ? 'integer' : 'string',
      }),
    ),
  );

@ApiTags('history')
@Controller('api/history')
export class HistoryController {
  constructor(@Inject(PROJECT) private readonly project: Project) {}

  @Get()
  @Read(
    'getHistory',
    'The history of edits, newest first, filtered and paged; secrets masked',
    historyResponse,
  )
  @HistoryQuery()
  @ApiBadRequestResponse({
    description: 'A filter that is not valid.',
    schema: ref(errorResponse),
  })
  @StateUnavailable()
  history(
    @Query({ schema: historyQuery }) query: z.output<typeof historyQuery>,
  ) {
    return readHistory(this.project, query);
  }

  @Post(':id/undo')
  @HttpCode(200)
  @Read(
    'undoChange',
    "Undoes one change: writes its previous state, only while the file still holds what it wrote. A secret's change can't be undone",
    undoResponse,
  )
  @ApiParam({ name: 'id', description: 'The change id.', type: 'integer' })
  @ApiBadRequestResponse({
    description: 'Not a change id.',
    schema: ref(errorResponse),
  })
  @ApiNotFoundResponse({
    description: 'No such change.',
    schema: ref(errorResponse),
  })
  @ApiConflictResponse({
    description:
      'The file no longer holds what the change wrote (its fingerprint differs); nothing was written. Carries the current state.',
    schema: ref(undoConflictResponse),
  })
  @ApiUnprocessableEntityResponse({
    description:
      "The change can't be undone (a secret's), or its previous state breaks the rules or a protected value now; nothing was written.",
    schema: ref(undoRefusedResponse),
  })
  @StateUnavailable()
  undo(@Param('id') id: string) {
    if (!/^[1-9]\d*$/.test(id))
      throw new ApiError(400, `${id}: is not a change id`);
    return undoHistoryChange(this.project, Number(id));
  }
}
