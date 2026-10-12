// Plan, then apply, over src/apply.ts.

import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { z } from 'zod';
import { applyProject, planProject } from './apply.ts';
import {
  applyRequest,
  applyResponse,
  errorResponse,
  planConflictResponse,
  planRequest,
  planResponse,
} from './contracts.ts';
import { NeedsSchema, PROJECT, Read, ref, requireSchemaRead } from './http.ts';
import type { Project } from './project.ts';

@ApiTags('apply')
@Controller('api')
export class PlanController {
  constructor(@Inject(PROJECT) private readonly project: Project) {}

  private read() {
    return requireSchemaRead(this.project);
  }

  @Post('plan')
  @HttpCode(200)
  @Read(
    'planChanges',
    'What applying would do to each file, with masked diffs; writes nothing',
    planResponse,
  )
  @ApiBody({ schema: ref(planRequest) })
  @NeedsSchema()
  async plan(
    @Body({ schema: planRequest }) body: z.output<typeof planRequest>,
  ) {
    return planProject(await this.read(), this.project, body);
  }

  @Post('apply')
  @HttpCode(200)
  @Read(
    'applyPlan',
    'Writes the plan shown, when its fingerprint still matches',
    applyResponse,
  )
  @ApiBody({ schema: ref(applyRequest) })
  @ApiConflictResponse({
    description:
      'The plan changed since it was shown (a file, the schema or the inputs); nothing was written.',
    schema: ref(planConflictResponse),
  })
  @ApiUnprocessableEntityResponse({
    description:
      'The plan has errors or changes protected values; nothing was written. Also an invalid schema.',
    schema: ref(planConflictResponse),
  })
  @ApiServiceUnavailableResponse({
    description:
      'The protected state cannot be read or used; nothing was written.',
    schema: ref(errorResponse),
  })
  async apply(
    @Body({ schema: applyRequest }) body: z.output<typeof applyRequest>,
  ) {
    return applyProject(await this.read(), this.project, body);
  }
}
