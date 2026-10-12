import { setupServer } from 'msw/node';
import { handlers } from '../mocks/handlers';

/** The API, mocked for every test; `server.use(...)` overrides per test. */
export const server = setupServer(...handlers);
