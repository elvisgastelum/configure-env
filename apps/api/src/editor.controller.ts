// POST /api/open-in-editor over src/editor.ts. Behind the same token guard as
// every route, and answered only for a request from this machine: it starts
// a process there.

import { Body, Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';
import {
  ApiBody,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import type { z } from 'zod';
import {
  errorResponse,
  openInEditorRequest,
  openInEditorResponse,
} from './contracts.ts';
import {
  type EditorLauncher,
  isLoopbackAddress,
  openInEditor,
} from './editor.ts';
import { ApiError, PROJECT, Read, ref } from './http.ts';
import type { Project } from './project.ts';

/** The provider token of the editor launcher. */
export const EDITOR = Symbol('EDITOR');

@ApiTags('project')
@Controller('api')
export class EditorController {
  constructor(
    @Inject(PROJECT) private readonly project: Project,
    @Inject(EDITOR) private readonly launcher: EditorLauncher,
  ) {}

  @Post('open-in-editor')
  @HttpCode(200)
  @Read(
    'openInEditor',
    "Opens the schema file or one of its env files at a line in the user's editor ($LAUNCH_EDITOR, else a running VS Code, Cursor, Zed or JetBrains IDE, else $VISUAL, else $EDITOR). Only from this machine",
    openInEditorResponse,
  )
  @ApiBody({ schema: ref(openInEditorRequest) })
  @ApiForbiddenResponse({
    description:
      'The request does not come from this machine, or the file path is refused: it is not a plain relative path or it leaves the root.',
    schema: ref(errorResponse),
  })
  @ApiNotFoundResponse({
    description:
      'Not the schema file or one of its env files, or the file does not exist.',
    schema: ref(errorResponse),
  })
  @ApiUnprocessableEntityResponse({
    description: 'A JSON path for an env file.',
    schema: ref(errorResponse),
  })
  open(
    @Req() request: Request,
    @Body({ schema: openInEditorRequest })
    body: z.output<typeof openInEditorRequest>,
  ) {
    if (!isLoopbackAddress(request.socket.remoteAddress))
      throw new ApiError(
        403,
        'open-in-editor answers only requests from this machine',
      );
    return openInEditor(this.project, body, this.launcher);
  }
}
