// msw handlers for the API, shared by the tests (msw/node) and Storybook
// (the service worker). `handlers` answers as a healthy sample project kept
// in ./store.ts, which the value and schema writes change; the scenarios
// override a few routes on top of it. The schema writes run the core's own
// schema writer, as the API does, so they refuse what the API refuses.

import * as writer from '@configure-env/core/schema';
import type {
  ApplyRequest,
  FixGitignoreRequest,
  OpenInEditorRequest,
  PlanRequest,
} from '@configure-env/api-client';
import type {
  FileInput,
  SchemaDocument,
  SchemaEditResult,
  VariableInput,
} from '@configure-env/core/schema';
import { HttpResponse, delay, http, sse } from 'msw';
import * as fixtures from './fixtures';
import {
  applyPlan,
  checkOf,
  fixGitignoreProblems,
  editorPosition,
  eventClients,
  findFile,
  findVariable,
  groupsOf,
  mockState,
  planOf,
  plainValue,
  problemsOf,
  protectedProblems,
  queryHistory,
  recordSchemaChange,
  recordValueChange,
  touchFile,
  undoMockChange,
  writeSchema,
  writeValue,
} from './store';

const json = <T extends object>(body: T) => HttpResponse.json(body);

interface ValuesBody {
  file: string;
  fingerprint: string | null;
  values?: Record<string, string>;
  generate?: string[];
  keys?: string[];
  replaceProtected?: string[];
}

/** The answers every value write shares: an unknown file, or a stale one. */
function refuseWrite({ file, fingerprint }: ValuesBody) {
  const info = findFile(file);
  if (!info)
    return HttpResponse.json(
      { statusCode: 404, message: `${file} is not a schema file` },
      { status: 404 },
    );
  if ((info.fingerprint ?? null) !== fingerprint)
    return HttpResponse.json(
      {
        statusCode: 409,
        message: `${file} changed since it was read; reload it and make the edit again`,
        file: info,
      },
      { status: 409 },
    );
  return undefined;
}

const editRefused = (
  kind: 'invalid' | 'protected',
  errors: { key?: string; message: string; reason?: string }[],
) =>
  HttpResponse.json(
    { statusCode: 422, message: 'nothing was written', kind, errors },
    { status: 422 },
  );

let generated = 0;

interface SchemaBody {
  fingerprint: string;
  [field: string]: unknown;
}

/**
 * A schema write as the API answers it: 409 over a stale fingerprint, 422
 * with the writer's errors (JSON paths) and the schema now, else the schema
 * written.
 */
async function schemaWrite(
  request: Request,
  edit: (document: SchemaDocument, body: SchemaBody) => SchemaEditResult,
) {
  const body = (await request.json()) as SchemaBody;
  const schema = mockState.schema;
  if (body.fingerprint !== schema.fingerprint)
    return HttpResponse.json(
      {
        statusCode: 409,
        message: `${schema.path} changed since it was read; reload it and make the edit again`,
        schema,
      },
      { status: 409 },
    );
  const result = edit(structuredClone(schema.document) as SchemaDocument, body);
  if (!result.ok)
    return HttpResponse.json(
      {
        statusCode: 422,
        message: 'the edit was refused; nothing was written',
        errors: result.errors,
        schema,
      },
      { status: 422 },
    );
  const before = fixtures.schemaText(schema.document);
  const written = writeSchema(result.document);
  const change = recordSchemaChange(
    before,
    fixtures.schemaText(written.document),
  );
  return json({ ...written, ...(change ? { change } : {}) });
}

const schemaWrites = [
  // The sample project has a schema: init keeps it (see scenarios.noSchema).
  http.post('/api/schema/init', () =>
    HttpResponse.json(
      {
        statusCode: 409,
        message: `${mockState.schema.path} exists; edit it instead`,
        schema: mockState.schema,
      },
      { status: 409 },
    ),
  ),
  http.post('/api/schema/variables', ({ request }) =>
    schemaWrite(request, (document, body) =>
      writer.addVariable(
        document,
        body.name as string,
        body.spec as VariableInput,
        { files: (body.files as string[] | undefined) ?? [] },
      ),
    ),
  ),
  http.put('/api/schema/variables/:name', ({ request, params }) =>
    schemaWrite(request, (document, body) =>
      writer.updateVariable(
        document,
        params.name as string,
        body.changes as Record<string, unknown>,
      ),
    ),
  ),
  http.delete('/api/schema/variables/:name', ({ request, params }) =>
    schemaWrite(request, (document, body) =>
      writer.removeVariable(document, params.name as string, {
        cleanup: Boolean(body.cleanup),
      }),
    ),
  ),
  http.post('/api/schema/variables/:name/rename', ({ request, params }) =>
    schemaWrite(request, (document, body) =>
      writer.renameVariable(document, params.name as string, body.to as string),
    ),
  ),
  http.put('/api/schema/variable-order', ({ request }) =>
    schemaWrite(request, (document, body) =>
      writer.reorderVariables(document, body.order as string[]),
    ),
  ),
  http.post('/api/schema/files', ({ request }) =>
    schemaWrite(request, (document, body) =>
      writer.addFile(document, body.spec as FileInput),
    ),
  ),
  http.put('/api/schema/files', ({ request }) =>
    schemaWrite(request, (document, body) =>
      writer.updateFile(
        document,
        body.path as string,
        body.changes as Record<string, unknown>,
      ),
    ),
  ),
  http.delete('/api/schema/files', ({ request }) =>
    schemaWrite(request, (document, body) =>
      writer.removeFile(document, body.path as string),
    ),
  ),
];

/**
 * GET /api/events: the stream stays open, and `emitChanged` sends on it. msw
 * mocks Server-Sent Events only where EventSource exists (the browser, and
 * the tests through a polyfill).
 */
const events =
  typeof EventSource === 'undefined'
    ? []
    : [
        sse<{ changed: { paths: string[] } }>('/api/events', ({ client }) => {
          eventClients.add(client);
        }),
      ];

export const handlers = [
  ...events,
  http.get('/api/health', () => json({ status: 'ok' })),
  http.get('/api/project', () => json(fixtures.project)),
  http.get('/api/schema', () => json(mockState.schema)),
  ...schemaWrites,
  http.get('/api/variables', () => json(mockState.variables)),
  http.get('/api/groups', () => json(groupsOf())),
  http.get('/api/files', () => json(mockState.files)),
  http.get('/api/check', () => json(fixtures.check)),
  http.post('/api/check/gitignore', async ({ request }) => {
    const { paths } = (await request.json()) as FixGitignoreRequest;
    return json({ fixed: fixGitignoreProblems(paths), check: checkOf() });
  }),
  http.post('/api/files/content', async ({ request }) => {
    const { file } = (await request.json()) as { file: string };
    const info = findFile(file);
    if (!info)
      return HttpResponse.json(
        { statusCode: 404, message: `${file} is not a schema file` },
        { status: 404 },
      );
    return json({
      file,
      exists: info.exists,
      lines: info.exists ? (mockState.lines.get(file) ?? []) : [],
    });
  }),
  http.post('/api/reveal', async ({ request }) => {
    const { file, key } = (await request.json()) as {
      file: string;
      key: string;
    };
    const known = findVariable(key)?.files.some((entry) => entry.file === file);
    if (!known)
      return HttpResponse.json(
        { statusCode: 404, message: `${key} is not in ${file}` },
        { status: 404 },
      );
    return json({ file, key, value: plainValue(file, key) });
  }),
  // Opens nothing: answers where the editor would open, the line of a key
  // from the file's lines, as the API's dotenv parser finds it.
  http.post('/api/open-in-editor', async ({ request }) => {
    const body = (await request.json()) as OpenInEditorRequest;
    const known =
      body.file === mockState.schema.path || findFile(body.file)?.exists;
    if (!known)
      return HttpResponse.json(
        {
          statusCode: 404,
          message: `${body.file} is not the schema file or one of its env files`,
        },
        { status: 404 },
      );
    return json({
      opened: true,
      file: body.file,
      ...editorPosition(body),
    });
  }),
  // What applying would do; the value and rule errors of the given values.
  http.post('/api/plan', async ({ request }) =>
    json(planOf((await request.json()) as PlanRequest)),
  ),
  http.post('/api/apply', async ({ request }) => {
    const body = (await request.json()) as ApplyRequest;
    const plan = planOf(body);
    if (plan.fingerprint !== body.fingerprint)
      return HttpResponse.json(
        {
          statusCode: 409,
          message: 'the plan changed since it was shown; nothing was written',
          plan,
        },
        { status: 409 },
      );
    if (!plan.ok)
      return HttpResponse.json(
        {
          statusCode: 422,
          message: 'the plan has errors; nothing was written',
          plan,
        },
        { status: 422 },
      );
    return json(applyPlan(body));
  }),
  http.post('/api/values/set', async ({ request }) => {
    const body = (await request.json()) as ValuesBody;
    const refusal = refuseWrite(body);
    if (refusal) return refusal;
    const values = { ...body.values };
    const invalid = problemsOf(body.file, values).map(
      ({ key, keys, message }) => ({ key: key ?? keys?.[0], message }),
    );
    for (const key of body.generate ?? []) {
      const spec = findVariable(key)?.spec;
      if (spec?.type !== 'string' || !spec.secret)
        invalid.push({ key, message: 'only a secret string can be generated' });
      generated += 1;
      values[key] = `${key.toLowerCase()}-generated-${generated}`;
    }
    if (invalid.length) return editRefused('invalid', invalid);
    const keys = Object.keys(values);
    const locked = protectedProblems(
      body.file,
      keys,
      body.replaceProtected ?? [],
    );
    if (locked.length) return editRefused('protected', locked);
    const changes: number[] = [];
    for (const key of keys) {
      const before = plainValue(body.file, key);
      writeValue(body.file, key, values[key]);
      const change = recordValueChange(body.file, key, before, values[key]!, {
        replaced: Boolean(body.replaceProtected?.includes(key)),
      });
      if (change) changes.push(change);
    }
    return json({
      file: body.file,
      fingerprint: touchFile(body.file),
      keys: keys.map((key) => ({ key, status: 'updated' })),
      replaced: (body.replaceProtected ?? []).filter((key) =>
        keys.includes(key),
      ),
      generated: body.generate ?? [],
      changes,
      warnings: [],
    });
  }),
  http.post('/api/values/unset', async ({ request }) => {
    const body = (await request.json()) as ValuesBody;
    const refusal = refuseWrite(body);
    if (refusal) return refusal;
    const keys = body.keys ?? [];
    const locked = protectedProblems(
      body.file,
      keys,
      body.replaceProtected ?? [],
    );
    if (locked.length) return editRefused('protected', locked);
    const changes: number[] = [];
    for (const key of keys) {
      const before = plainValue(body.file, key);
      writeValue(body.file, key);
      const change = recordValueChange(body.file, key, before, null, {
        replaced: Boolean(body.replaceProtected?.includes(key)),
      });
      if (change) changes.push(change);
    }
    return json({
      file: body.file,
      fingerprint: touchFile(body.file),
      keys: keys.map((key) => ({ key, status: 'removed' })),
      replaced: (body.replaceProtected ?? []).filter((key) =>
        keys.includes(key),
      ),
      generated: [],
      changes,
      warnings: [],
    });
  }),
  http.get('/api/history', ({ request }) => {
    const params = new URL(request.url).searchParams;
    const number = (name: string) => {
      const value = params.get(name);
      return value === null ? undefined : Number(value);
    };
    return json(
      queryHistory({
        file: params.get('file'),
        key: params.get('key'),
        actor: params.get('actor'),
        from: params.get('from'),
        to: params.get('to'),
        page: number('page'),
        limit: number('limit'),
      }),
    );
  }),
  http.post('/api/history/:id/undo', ({ params }) => {
    const { status, body } = undoMockChange(Number(params.id));
    return HttpResponse.json(body, { status });
  }),
];

const schemaNeeded = () =>
  HttpResponse.json(
    {
      statusCode: 422,
      message: 'env.schema.json is invalid',
      errors: fixtures.missingSchema.errors,
    },
    { status: 422 },
  );

/** In scenarios.noSchema: whether init has not written the schema yet. */
const missing = () => mockState.schemaWrites === 0;

/** Overrides for named situations; put them before `handlers`. */
export const scenarios = {
  /** Nothing was changed yet: the history is empty. */
  noHistory: [
    http.get('/api/history', () =>
      json({ changes: [], total: 0, page: 1, limit: 20 }),
    ),
  ],
  /** One more variable per editable type, in `.env`. */
  allTypes: [
    http.get('/api/variables', () => {
      if (!findVariable(fixtures.typedVariables[0]!.name))
        mockState.variables.variables.push(
          ...structuredClone(fixtures.typedVariables),
        );
      return json(mockState.variables);
    }),
  ],
  /** The schema declares one more variable of each type the sample lacks. */
  schemaTypes: [
    http.get('/api/schema', () => {
      const document = mockState.schema.document as SchemaDocument;
      if (!document.variables.DEBUG)
        Object.assign(
          document.variables,
          structuredClone(fixtures.typedSchemaVariables),
        );
      return json(mockState.schema);
    }),
  ],
  /** A schema of two thousand variables. */
  largeSchema: [
    http.get('/api/variables', () =>
      json({ variables: fixtures.manyVariables(2000) }),
    ),
  ],
  /** The project has no schema file yet. */
  noSchema: [
    http.get('/api/schema', () =>
      json(missing() ? fixtures.missingSchema : mockState.schema),
    ),
    http.get('/api/variables', () =>
      missing() ? schemaNeeded() : json(mockState.variables),
    ),
    http.get('/api/groups', () =>
      missing() ? schemaNeeded() : json(groupsOf()),
    ),
    http.get('/api/files', () =>
      missing() ? schemaNeeded() : json(mockState.files),
    ),
    http.get('/api/check', () =>
      missing() ? schemaNeeded() : json(fixtures.check),
    ),
    // Init writes the sample schema, as if inferred from its .env.example.
    http.post('/api/schema/init', () => {
      if (!missing())
        return HttpResponse.json(
          {
            statusCode: 409,
            message: `${mockState.schema.path} exists; edit it instead`,
            schema: mockState.schema,
          },
          { status: 409 },
        );
      return json(writeSchema(fixtures.schema.document));
    }),
  ],
  /** The schema exists but breaks the format. */
  invalidSchema: [
    http.get('/api/schema', () => json(fixtures.invalidSchema)),
    http.get('/api/variables', schemaNeeded),
    http.get('/api/groups', schemaNeeded),
    http.get('/api/files', schemaNeeded),
    http.get('/api/check', schemaNeeded),
  ],
  /**
   * GET /api/check computed from the in-memory sample project (`checkOf`), so
   * a fix made in the portal or outside it shows in the next report: drift,
   * modes, missing keys, bad lines, invalid and missing required values, and
   * unknown keys as warnings. It reports no rule or protected-value problems.
   */
  liveReports: [http.get('/api/check', () => json(checkOf()))],
  /** Check reports one of every kind of problem. */
  everyProblem: [http.get('/api/check', () => json(fixtures.checkReport))],
  /** Check reports only warnings: unknown keys, which do not fail it. */
  onlyWarnings: [http.get('/api/check', () => json(fixtures.warningsCheck))],
  /** Check reports two dozen files, every fifth one failing. */
  manyFiles: [http.get('/api/check', () => json(fixtures.manyFilesCheck()))],
  /** No editor is set or running: open-in-editor says so. */
  noEditor: [
    http.post('/api/open-in-editor', async ({ request }) => {
      const body = (await request.json()) as OpenInEditorRequest;
      return json({
        opened: false,
        reason: 'no-editor',
        message:
          'No editor was found: set $LAUNCH_EDITOR, $VISUAL or $EDITOR, or open VS Code, Cursor, Zed or a JetBrains IDE.',
        file: body.file,
        ...editorPosition(body),
      });
    }),
  ],
  /** The editor found is vim, which runs in a terminal: open-in-editor says so. */
  terminalEditor: [
    http.post('/api/open-in-editor', async ({ request }) => {
      const body = (await request.json()) as OpenInEditorRequest;
      return json({
        opened: false,
        reason: 'terminal-editor',
        message:
          "'vim' runs in a terminal, and the server has none to give it: set $LAUNCH_EDITOR to a GUI editor, or open VS Code, Cursor, Zed or a JetBrains IDE.",
        file: body.file,
        ...editorPosition(body),
      });
    }),
  ],
  /** open-in-editor refuses the file: it leads out of the root. */
  editorRefused: [
    http.post('/api/open-in-editor', async ({ request }) => {
      const { file } = (await request.json()) as OpenInEditorRequest;
      return HttpResponse.json(
        {
          statusCode: 403,
          message: `${file}: resolves outside the root through a symlink`,
        },
        { status: 403 },
      );
    }),
  ],
  /** The plan shows every action a file can take. */
  everyAction: [http.post('/api/plan', () => json(fixtures.everyActionPlan))],
  /** Every env file matches its schema. */
  passing: [http.get('/api/check', () => json(fixtures.passingCheck))],
  /** Nothing ever answers: the skeletons stay. */
  loading: [
    http.get('/api/*', async () => {
      await delay('infinite');
      return HttpResponse.json({});
    }),
  ],
  /** No session cookie: every request is refused. */
  unauthorized: [
    http.get('/api/*', () =>
      HttpResponse.json(
        { statusCode: 401, message: 'a valid token is required' },
        { status: 401 },
      ),
    ),
  ],
};
