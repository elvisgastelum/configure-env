// msw handlers for the API, shared by the tests (msw/node) and Storybook
// (the service worker). `handlers` answers as a healthy sample project; the
// scenarios override a few routes on top of it.

import { HttpResponse, delay, http } from 'msw';
import * as fixtures from './fixtures';

const json = <T extends object>(body: T) => HttpResponse.json(body);

export const handlers = [
  http.get('/api/health', () => json({ status: 'ok' })),
  http.get('/api/project', () => json(fixtures.project)),
  http.get('/api/schema', () => json(fixtures.schema)),
  http.get('/api/variables', () => json(fixtures.variables)),
  http.get('/api/files', () => json(fixtures.files)),
  http.get('/api/check', () => json(fixtures.check)),
  http.get('/api/validate', () => json(fixtures.validate)),
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
