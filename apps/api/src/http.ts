// What the controllers share: the provider tokens, the decorators that
// declare a route's contract, and the errors a route answers with.

import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  SerializeOptions,
  applyDecorators,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { EnvSchema } from '@configure-env/core';
import type { Response } from 'express';
import type { z } from 'zod';
import { components, invalidSchemaResponse } from './contracts.ts';
import { type Project, readSchema } from './project.ts';

/** The provider token of the bound project. */
export const PROJECT = Symbol('PROJECT');
/** The provider token of the configure-env version. */
export const VERSION = Symbol('VERSION');

/** A `$ref` to the schema's OpenAPI component. */
export const ref = (schema: z.ZodType) => {
  const id = components.get(schema)?.id;
  if (!id) throw new Error('schema is not a registered component');
  return { $ref: `#/components/schemas/${id}` };
};

/** The operation id, its 200 response, and the schema shaping that response. */
export const Read = (operationId: string, summary: string, schema: z.ZodType) =>
  applyDecorators(
    ApiOperation({ operationId, summary }),
    ApiOkResponse({ schema: ref(schema) }),
    SerializeOptions({ schema }),
  );

/** For the routes that need a valid schema. */
export const NeedsSchema = () =>
  ApiUnprocessableEntityResponse({
    description: 'The schema is invalid.',
    schema: ref(invalidSchemaResponse),
  });

/**
 * Thrown for a request the project cannot answer: its status, its message,
 * and any other fields of the error body. The filter below maps it.
 */
export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** Maps an ApiError to its status with the usual error body. */
@Catch(ApiError)
export class ApiErrorFilter implements ExceptionFilter {
  catch(error: ApiError, host: ArgumentsHost) {
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(error.statusCode)
      .json({
        statusCode: error.statusCode,
        message: error.message,
        ...error.body,
      });
  }
}

/** The valid schema with the fingerprint of its bytes, or a 422 with its errors. */
export async function requireSchemaRead(
  project: Project,
): Promise<{ schema: EnvSchema; fingerprint: string }> {
  const read = await readSchema(project);
  if (read.schema && read.fingerprint)
    return { schema: read.schema, fingerprint: read.fingerprint };
  throw new HttpException(
    {
      statusCode: 422,
      message: `${project.schemaPath} is invalid`,
      errors: read.errors,
    },
    422,
  );
}

/** The valid schema, or a 422 with its errors. */
export const requireSchema = async (project: Project): Promise<EnvSchema> =>
  (await requireSchemaRead(project)).schema;
