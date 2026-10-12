// `createServer`: the API in-process, for `configure-env serve` and for the
// standalone src/main.ts. It binds 127.0.0.1 unless told otherwise, and
// every request passes src/security.ts first.

import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import { isIPv6 } from 'node:net';
import { resolve } from 'node:path';
import {
  type INestApplication,
  StandardSchemaSerializerInterceptor,
  StandardSchemaValidationPipe,
} from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { Express, NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import packageJson from '../package.json' with { type: 'json' };
import { InspectErrorFilter, apiModule } from './api.module.ts';
import { components } from './contracts.ts';
import { type Project, resolveProject } from './project.ts';
import { LAUNCH_PATH, securityMiddleware } from './security.ts';

export const DEFAULT_HOST = '127.0.0.1';
export const OPENAPI_PATH = '/api/openapi.json';
const MIN_TOKEN_LENGTH = 32;

export interface ServerOptions {
  /** The project root; every path the API touches stays inside it. */
  root: string;
  /** The schema file, relative to the root (or absolute inside it). */
  schemaPath: string;
  /** Defaults to 127.0.0.1. */
  host?: string;
  /** 0 picks a free port. */
  port: number;
  /** The per-run secret every request must carry; at least 32 characters. */
  token: string;
  /**
   * A directory of static files (the portal's `dist/`) served behind the
   * token; a page request no file matches gets its index.html.
   */
  staticDir?: string;
  /** Reported by GET /api/project; defaults to this package's version. */
  version?: string;
}

export interface ApiServer {
  host: string;
  port: number;
  /** `http://host:port`. */
  url: string;
  /** Opens a browser session: sets the token cookie, then redirects to `/`. */
  launchUrl: string;
  close(): Promise<void>;
}

/** `host:port` as a Host header holds it, IPv6 bracketed. */
const hostPort = (host: string, port: number) =>
  `${isIPv6(host) ? `[${host}]` : host}:${port}`.toLowerCase();

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

/** The Nest application for a project, configured but not listening. */
async function createApp(
  project: Project,
  version: string,
): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(
    apiModule(project, version),
    { logger: false, abortOnError: false, bodyParser: true },
  );
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  app.useGlobalInterceptors(
    new StandardSchemaSerializerInterceptor(app.get(Reflector)),
  );
  app.useGlobalFilters(new InspectErrorFilter());
  app.disable('x-powered-by');
  return app;
}

/** The OpenAPI document of an initialized app, components from src/contracts.ts. */
export function openApiDocument(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('configure-env API')
    .setDescription(
      "The local configure-env server: a project's schema and env files. Every request needs the per-run token, as a bearer token or the cookie the launch URL sets.",
    )
    .setVersion('1')
    .addBearerAuth()
    .addSecurityRequirements('bearer')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  const { schemas } = z.toJSONSchema(components, {
    target: 'openapi-3.0',
    io: 'output',
    uri: (id) => `#/components/schemas/${id}`,
  }) as { schemas: Record<string, Record<string, unknown>> };
  document.components ??= {};
  document.components.schemas = {
    ...document.components.schemas,
    ...Object.fromEntries(
      Object.entries(schemas)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, schema]) => {
          // zod names each component by its own `$id`; OpenAPI keys it instead.
          delete schema.$id;
          return [id, schema];
        }),
    ),
  } as typeof document.components.schemas;
  return document;
}

/** The OpenAPI document, built without a project or a listening server. */
export async function buildOpenApiDocument() {
  const project: Project = {
    root: '/',
    schemaFile: '/env.schema.json',
    schemaPath: 'env.schema.json',
  };
  const app = await createApp(project, packageJson.version);
  try {
    await app.init();
    return openApiDocument(app);
  } finally {
    await app.close();
  }
}

/**
 * Answers a page request the static files did not (a deep link such as
 * `/variables`, opened or reloaded) with the portal's index.html, so its
 * router can render it. API paths, file paths (an extension: a missing
 * asset stays a 404) and non-HTML requests pass on. It runs after the
 * token guard, like every static file.
 */
function portalFallback(index: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const path = req.path;
    const page =
      (req.method === 'GET' || req.method === 'HEAD') &&
      path !== '/api' &&
      !path.startsWith('/api/') &&
      !/\.[^/]*$/.test(path) &&
      req.accepts(['html', 'json']) === 'html';
    if (!page) return next();
    res.sendFile(index, (error) => {
      if (error) next(error);
    });
  };
}

/** Starts the API over a project and resolves once it listens. */
export async function createServer(options: ServerOptions): Promise<ApiServer> {
  if (options.token.length < MIN_TOKEN_LENGTH)
    throw new Error(
      `the token must be at least ${MIN_TOKEN_LENGTH} characters`,
    );
  const host = options.host ?? DEFAULT_HOST;
  const project = await resolveProject(options.root, options.schemaPath);
  const app = await createApp(project, options.version ?? packageJson.version);

  let port = options.port;
  const hosts = () => {
    const allowed = new Set([hostPort(host, port)]);
    if (LOOPBACK.has(host))
      for (const name of LOOPBACK) allowed.add(hostPort(name, port));
    return allowed;
  };
  app.use(
    securityMiddleware({
      token: options.token,
      hosts,
      cookie: () => `configure_env_token_${port}`,
    }),
  );
  if (options.staticDir) {
    app.useStaticAssets(options.staticDir, {
      dotfiles: 'deny',
      index: 'index.html',
    });
    app.use(portalFallback(resolve(options.staticDir, 'index.html')));
  }

  let document: unknown;
  (app.getHttpAdapter().getInstance() as Express).get(
    OPENAPI_PATH,
    (_req, res) => {
      document ??= openApiDocument(app);
      res.json(document);
    },
  );

  await app.listen(options.port, host);
  port = (app.getHttpServer().address() as AddressInfo).port;
  const url = `http://${hostPort(host, port)}`;
  return {
    host,
    port,
    url,
    launchUrl: `${url}${LAUNCH_PATH}?token=${encodeURIComponent(options.token)}`,
    close: () => app.close(),
  };
}
