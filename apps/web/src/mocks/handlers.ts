// msw handlers for the API, shared by the tests (msw/node) and Storybook
// (the service worker). `handlers` answers as a healthy sample project kept
// in ./store.ts, which the value writes change; the scenarios override a few
// routes on top of it.

import { HttpResponse, delay, http } from 'msw';
import * as fixtures from './fixtures';
import {
  findFile,
  findVariable,
  mockState,
  plainValue,
  problemsOf,
  protectedProblems,
  touchFile,
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

export const handlers = [
  http.get('/api/health', () => json({ status: 'ok' })),
  http.get('/api/project', () => json(fixtures.project)),
  http.get('/api/schema', () => json(fixtures.schema)),
  http.get('/api/variables', () => json(mockState.variables)),
  http.get('/api/files', () => json(mockState.files)),
  http.get('/api/check', () => json(fixtures.check)),
  http.get('/api/validate', () => json(fixtures.validate)),
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
  // A dry run: only the value and rule errors of the given values.
  http.post('/api/plan', async ({ request }) => {
    const body = (await request.json()) as {
      values?: Record<string, string>;
      files?: string[];
    };
    const errors = problemsOf(body.files?.[0] ?? '.env', body.values ?? {});
    return json({
      fingerprint: 'plan',
      ok: errors.length === 0,
      files: [],
      errors,
      protected: [],
    });
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
    for (const key of keys) writeValue(body.file, key, values[key]);
    return json({
      file: body.file,
      fingerprint: touchFile(body.file),
      keys: keys.map((key) => ({ key, status: 'updated' })),
      replaced: (body.replaceProtected ?? []).filter((key) =>
        keys.includes(key),
      ),
      generated: body.generate ?? [],
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
    for (const key of keys) writeValue(body.file, key);
    return json({
      file: body.file,
      fingerprint: touchFile(body.file),
      keys: keys.map((key) => ({ key, status: 'removed' })),
      replaced: (body.replaceProtected ?? []).filter((key) =>
        keys.includes(key),
      ),
      generated: [],
      warnings: [],
    });
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

/** Overrides for named situations; put them before `handlers`. */
export const scenarios = {
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
  /** A schema of two thousand variables. */
  largeSchema: [
    http.get('/api/variables', () =>
      json({ variables: fixtures.manyVariables(2000) }),
    ),
  ],
  /** The project has no schema file yet. */
  noSchema: [
    http.get('/api/schema', () => json(fixtures.missingSchema)),
    http.get('/api/variables', schemaNeeded),
    http.get('/api/files', schemaNeeded),
    http.get('/api/check', schemaNeeded),
    http.get('/api/validate', schemaNeeded),
  ],
  /** The schema exists but breaks the format. */
  invalidSchema: [
    http.get('/api/schema', () => json(fixtures.invalidSchema)),
    http.get('/api/variables', schemaNeeded),
    http.get('/api/files', schemaNeeded),
    http.get('/api/check', schemaNeeded),
    http.get('/api/validate', schemaNeeded),
  ],
  /** Every env file matches its schema. */
  passing: [
    http.get('/api/check', () => json(fixtures.passingCheck)),
    http.get('/api/validate', () => json(fixtures.passingValidate)),
  ],
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
