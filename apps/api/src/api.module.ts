// The read-only HTTP surface: thin controllers over src/inspect.ts, and the
// module that binds every controller to a project. Every injection names its
// token, so nothing depends on emitted decorator metadata.

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Module,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBody,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { EnvSchema } from '@configure-env/core';
import type { z } from 'zod';
import {
  checkResponse,
  errorResponse,
  filesResponse,
  healthResponse,
  projectResponse,
  revealRequest,
  revealResponse,
  schemaResponse,
  strictQuery,
  validateResponse,
  variablesResponse,
} from './contracts.ts';
import {
  NeedsSchema,
  PROJECT,
  Read,
  VERSION,
  ref,
  requireSchema,
} from './http.ts';
import {
  checkProject,
  listFiles,
  listVariables,
  revealValue,
  validateProject,
} from './inspect.ts';
import type { Project } from './project.ts';
import { currentSchema } from './schema.ts';
import { PlanController } from './plan.controller.ts';
import { SchemaController } from './schema.controller.ts';
import { ValuesController } from './values.controller.ts';

export { PROJECT, VERSION } from './http.ts';

// Swagger finds parameters through emitted metadata, which is not emitted
// here; the request body and query are declared explicitly instead.
const StrictQuery = () =>
  ApiQuery({
    name: 'strict',
    required: false,
    enum: ['true', 'false'],
    description: 'Treat keys the schema does not list for a file as errors.',
  });

const isStrict = (query: z.output<typeof strictQuery>) =>
  query.strict === 'true';

@ApiTags('project')
@Controller('api')
export class ProjectController {
  constructor(
    @Inject(PROJECT) private readonly project: Project,
    @Inject(VERSION) private readonly version: string,
  ) {}

  /** The valid schema, or a 422 with its errors. */
  private schema(): Promise<EnvSchema> {
    return requireSchema(this.project);
  }

  @Get('health')
  @Read('getHealth', 'Whether the server is up', healthResponse)
  health(): z.output<typeof healthResponse> {
    return { status: 'ok' };
  }

  @Get('project')
  @Read(
    'getProject',
    'The project root, schema path and version',
    projectResponse,
  )
  info(): z.output<typeof projectResponse> {
    return {
      root: this.project.root,
      schemaPath: this.project.schemaPath,
      version: this.version,
    };
  }

  @Get('schema')
  @Read(
    'getSchema',
    'The schema file and its errors, with JSON paths',
    schemaResponse,
  )
  schemaFile(): Promise<z.output<typeof schemaResponse>> {
    return currentSchema(this.project);
  }

  @Get('variables')
  @Read(
    'getVariables',
    'Every variable with its spec and value status per file; secrets masked',
    variablesResponse,
  )
  @NeedsSchema()
  async variables() {
    return listVariables(await this.schema(), this.project.root);
  }

  @Get('files')
  @Read(
    'getFiles',
    'Every schema file with its policy, mode, drift and parse errors',
    filesResponse,
  )
  @NeedsSchema()
  async files() {
    return listFiles(await this.schema(), this.project.root);
  }

  @Post('reveal')
  @HttpCode(200)
  @Read('revealValue', 'One value, unmasked', revealResponse)
  @ApiBody({ schema: ref(revealRequest) })
  @NeedsSchema()
  @ApiNotFoundResponse({
    description: 'Not a schema file, or not one of its variables.',
    schema: ref(errorResponse),
  })
  @ApiForbiddenResponse({
    description: 'The file path is refused: it leaves the root.',
    schema: ref(errorResponse),
  })
  async reveal(
    @Body({ schema: revealRequest }) body: z.output<typeof revealRequest>,
  ) {
    return revealValue(
      await this.schema(),
      this.project.root,
      body.file,
      body.key,
    );
  }

  @Get('check')
  @Read(
    'getCheck',
    'The drift report, as configure-env check gives it',
    checkResponse,
  )
  @StrictQuery()
  @NeedsSchema()
  async check(
    @Query({ schema: strictQuery }) query: z.output<typeof strictQuery>,
  ) {
    return checkProject(
      await this.schema(),
      this.project.root,
      isStrict(query),
    );
  }

  @Get('validate')
  @Read(
    'getValidate',
    'Rule and value errors per file, as configure-env validate gives them',
    validateResponse,
  )
  @StrictQuery()
  @NeedsSchema()
  async validate(
    @Query({ schema: strictQuery }) query: z.output<typeof strictQuery>,
  ) {
    return validateProject(
      await this.schema(),
      this.project.root,
      isStrict(query),
    );
  }
}

/** The module for a bound project. */
export function apiModule(project: Project, version: string) {
  @Module({
    controllers: [
      ProjectController,
      ValuesController,
      PlanController,
      SchemaController,
    ],
    providers: [
      { provide: PROJECT, useValue: project },
      { provide: VERSION, useValue: version },
    ],
  })
  class ApiModule {}
  return ApiModule;
}
