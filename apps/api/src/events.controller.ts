// GET /api/events: the live updates of src/events.ts, as Server-Sent
// Events. It passes the same token, Host and Origin guard as every route.

import { Controller, Get, Inject, Res } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ProjectEvents } from './events.ts';

@ApiTags('events')
@Controller('api')
export class EventsController {
  constructor(@Inject(ProjectEvents) private readonly events: ProjectEvents) {}

  @Get('events')
  @ApiOperation({
    operationId: 'getEvents',
    summary:
      'Server-Sent Events: `changed`, with the paths, when the schema or an env file changes on disk',
  })
  @ApiProduces('text/event-stream')
  @ApiOkResponse({
    description:
      'An event stream. Each `changed` event holds `{"paths": [...]}`, relative to the root; refetch what they show.',
    schema: { type: 'string' },
  })
  async stream(@Res() res: Response): Promise<void> {
    await this.events.subscribe(res);
  }
}
