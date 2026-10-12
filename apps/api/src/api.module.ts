// The HTTP surface: thin controllers over src/inspect.ts. Every injection
// names its token, so nothing depends on emitted decorator metadata.

import {
  type ArgumentsHost,
  Body,
  Catch,
  Controller,
  type ExceptionFilter,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Module,
  Post,
  Query,
  SerializeOptions,
  applyDecorators,
} from '@nestjs/common';
import {
  ApiBody,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { EnvSchema } from '@configure-env/core';
import type { Response } from 'express';
import type { z } from 'zod';
import {
  checkResponse,
  components,
  errorResponse,
  filesResponse,
  healthResponse,
  invalidSchemaResponse,
  projectResponse,
  revealRequest,
  revealResponse,
  schemaResponse,
  strictQuery,
  validateResponse,
  variablesResponse,
} from './contracts.ts';
import {
  InspectError,
  checkProject,
  listFiles,
  listVariables,
  revealValue,
  validateProject,
} from './inspect.ts';
import { type Project, readSchema } from './project.ts';

/** The provider token of the bound project. */
export const PROJECT = Symbol('PROJECT');
/** The provider token of the configure-env version. */
export const VERSION = Symbol('VERSION');

/** A `$ref` to the schema's OpenAPI component. */
const ref = (schema: z.ZodType) => {
  const id = components.get(schema)?.id;
  if (!id) throw new Error('schema is not a registered component');
  return { $ref: `#/components/schemas/${id}` };
};

/** The operation id, its 200 response, and the schema shaping that response. */
const Read = (operationId: string, summary: string, schema: z.ZodType) =>
  applyDecorators(
    ApiOperation({ operationId, summary }),
    ApiOkResponse({ schema: ref(schema) }),
    SerializeOptions({ schema }),
  );

/** For the routes that need a valid schema. */
const NeedsSchema = () =>
  ApiUnprocessableEntityResponse({
    description: 'The schema is invalid.',
    schema: ref(invalidSchemaResponse),
  });

/** Maps an InspectError to its status with the usual error body. */
@Catch(InspectError)
export class InspectErrorFilter implements ExceptionFilter {
  catch(error: InspectError, host: ArgumentsHost) {
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(error.statusCode)
      .json({ statusCode: error.statusCode, message: error.message });
  }
}

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
  private async schema(): Promise<EnvSchema> {
    const read = await readSchema(this.project);
    if (read.schema) return read.schema;
    throw new HttpException(
      {
        statusCode: 422,
        message: `${this.project.schemaPath} is invalid`,
        errors: read.errors,
      },
      422,
    );
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
  async schemaFile(): Promise<z.output<typeof schemaResponse>> {
    const read = await readSchema(this.project);
    return {
      path: this.project.schemaPath,
      valid: Boolean(read.schema),
      document: read.document,
      errors: read.errors,
    };
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
    controllers: [ProjectController],
    providers: [
      { provide: PROJECT, useValue: project },
      { provide: VERSION, useValue: version },
    ],
  })
  class ApiModule {}
  return ApiModule;
}
