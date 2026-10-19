// GET /api/environments over src/gateway.ts: this server and the other
// environments the portal can switch to, each probed for whether it answers.
// A probe is reused for a few seconds (see ProbeCache), so the portal does
// not wait on every server on every call.
// The response contract is an allowlist, so a token never leaves.

import { Controller, Get, Inject } from '@nestjs/common';
import { ApiInternalServerErrorResponse, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { environmentsResponse, errorResponse } from './contracts.ts';
import {
  type EnvironmentsSource,
  GatewayError,
  ProbeCache,
  listEnvironments,
} from './gateway.ts';
import { ApiError, Read, VERSION, ref } from './http.ts';

/** The provider token of the environments source. */
export const ENVIRONMENTS = Symbol('ENVIRONMENTS');

@ApiTags('environments')
@Controller('api')
export class EnvironmentsController {
  private readonly probes = new ProbeCache();

  constructor(
    @Inject(ENVIRONMENTS) private readonly source: EnvironmentsSource,
    @Inject(VERSION) private readonly version: string,
  ) {}

  @Get('environments')
  @Read(
    'getEnvironments',
    "The environments the portal can switch to: this server, then each of .configure-env/environments.json with its URL, whether it answers and its version. Never a token. Another environment's API is at /env/{name}/api/",
    environmentsResponse,
  )
  @ApiInternalServerErrorResponse({
    description: '.configure-env/environments.json cannot be read.',
    schema: ref(errorResponse),
  })
  async list(): Promise<z.output<typeof environmentsResponse>> {
    try {
      return {
        environments: await listEnvironments(
          this.source,
          this.version,
          this.probes,
        ),
      };
    } catch (error) {
      if (error instanceof GatewayError)
        throw new ApiError(error.statusCode, error.message);
      throw error;
    }
  }
}
