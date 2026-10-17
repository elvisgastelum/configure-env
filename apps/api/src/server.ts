// `createServer`: the API in-process, for `configure-env serve` and for the
// standalone src/main.ts. It binds 127.0.0.1 unless told otherwise, and
// every request passes src/security.ts first. It serves HTTPS when given a
// certificate, and a public URL (a reverse proxy's) joins the addresses it
// answers.

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
import type { StateWriter } from '@configure-env/core';
import packageJson from '../package.json' with { type: 'json' };
import { apiModule } from './api.module.ts';
import { components } from './contracts.ts';
import { type EditorLauncher, createLauncher } from './editor.ts';
import { ApiErrorFilter } from './http.ts';
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
  /**
   * The state database, relative to the root or absolute; defaults to
   * .configure-env/state.db in the root. Its path shows in messages as given.
   */
  statePath?: string;
  /**
   * Reads the schema wherever schemaPath leads, outside the root or through
   * a symlink: for the CLI's in-process server, which runs one command on
   * the paths the person named. Never for a server others reach.
   */
  schemaAnywhere?: boolean;
  /** Defaults to 127.0.0.1. */
  host?: string;
  /** 0 picks a free port. */
  port: number;
  /** The secret every request must carry; at least 32 characters. */
  token: string;
  /**
   * The address clients reach the server at, such as a reverse proxy's
   * `https://env.example.com`: an http or https origin, without a path.
   * Its host is answered besides the bound one, and `url` and `launchUrl`
   * name it.
   */
  publicUrl?: string;
  /** A PEM certificate and its private key: the server speaks HTTPS. */
  tls?: { cert: string | Buffer; key: string | Buffer };
  /**
   * A directory of static files (the portal's `dist/`) served behind the
   * token; a page request no file matches gets its index.html.
   */
  staticDir?: string;
  /** Reported by GET /api/project; defaults to this package's version. */
  version?: string;
  /**
   * Opens a file in the user's editor for POST /api/open-in-editor;
   * defaults to launch-editor. The tests pass one that starts nothing.
   */
  editor?: EditorLauncher;
  /**
   * What paths in an apply's messages are relative to, as the CLI's
   * in-process server shows them; the root when absent.
   */
  cwd?: string;
  /** Writes the protected state; for the CLI's tests, which pass one that fails. */
  writeState?: StateWriter;
}

export interface ApiServer {
  host: string;
  port: number;
  /** The public URL, else `http://host:port` (`https://` with TLS). */
  url: string;
  /** Opens a browser session: sets the token cookie, then redirects to `/`. */
  launchUrl: string;
  close(): Promise<void>;
}

/** `host:port` as a Host header holds it, IPv6 bracketed. */
const hostPort = (host: string, port: number) =>
  `${isIPv6(host) ? `[${host}]` : host}:${port}`.toLowerCase();

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

/** The public URL's origin; anything else than an http(s) origin throws. */
function publicOrigin(publicUrl: string): URL {
  let url: URL | undefined;
  try {
    url = new URL(publicUrl);
  } catch {
    url = undefined;
  }
  if (
    !url ||
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error(
      `the public URL must be an http or https origin without a path, such as https://env.example.com; got ${publicUrl}`,
    );
  return url;
}

/** The Nest application for a project, configured but not listening. */
async function createApp(
  project: Project,
  version: string,
  editor: EditorLauncher = createLauncher(),
  localHosts: () => ReadonlySet<string> = () => new Set(),
  tls?: ServerOptions['tls'],
): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(
    apiModule(project, version, editor, localHosts),
    // forceCloseConnections: close() ends open keep-alive connections too,
    // so a stopping `configure-env serve` never waits on a browser tab.
    {
      logger: false,
      abortOnError: false,
      bodyParser: true,
      forceCloseConnections: true,
      ...(tls ? { httpsOptions: { cert: tls.cert, key: tls.key } } : {}),
    },
  );
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  app.useGlobalInterceptors(
    new StandardSchemaSerializerInterceptor(app.get(Reflector)),
  );
  app.useGlobalFilters(new ApiErrorFilter());
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
    statePath: '/.configure-env/state.db',
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
  const publicUrl =
    options.publicUrl === undefined
      ? undefined
      : publicOrigin(options.publicUrl);
  const scheme = options.tls ? 'https' : 'http';
  const project = await resolveProject(options.root, options.schemaPath, {
    ...(options.statePath === undefined
      ? {}
      : { statePath: options.statePath }),
    ...(options.schemaAnywhere ? { schemaAnywhere: true } : {}),
  });
  if (options.cwd !== undefined) project.cwd = options.cwd;
  if (options.writeState) project.writeState = options.writeState;

  let port = options.port;
  /** The Host values of the address the server listens on. */
  const localHosts = () => {
    const allowed = new Set([hostPort(host, port)]);
    if (LOOPBACK.has(host))
      for (const name of LOOPBACK) allowed.add(hostPort(name, port));
    return allowed;
  };
  const hosts = () => {
    const allowed = localHosts();
    if (publicUrl) allowed.add(publicUrl.host);
    return allowed;
  };
  const origins = () => {
    const allowed = new Set(
      [...localHosts()].map((name) => new URL(`${scheme}://${name}`).origin),
    );
    if (publicUrl) allowed.add(publicUrl.origin);
    return allowed;
  };

  const app = await createApp(
    project,
    options.version ?? packageJson.version,
    options.editor,
    localHosts,
    options.tls,
  );
  app.use(
    securityMiddleware({
      token: options.token,
      hosts,
      origins,
      cookie: () => `configure_env_token_${port}`,
      secure: scheme === 'https' || publicUrl?.protocol === 'https:',
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

  try {
    await app.listen(options.port, host);
  } catch (error) {
    // A taken port: release what the app holds, so a retry starts clean.
    await app.close().catch(() => {});
    throw error;
  }
  port = (app.getHttpServer().address() as AddressInfo).port;
  const url = publicUrl
    ? publicUrl.origin
    : `${scheme}://${hostPort(host, port)}`;
  return {
    host,
    port,
    url,
    launchUrl: `${url}${LAUNCH_PATH}?token=${encodeURIComponent(options.token)}`,
    close: () => app.close(),
  };
}
