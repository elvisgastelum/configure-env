import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import {
  getCheck,
  getEnvironments,
  getEvents,
  fixGitignore,
} from './client.ts';
import {
  CLIENT_HEADER,
  apiBasePath,
  apiFetch,
  environmentBasePath,
  setApiBasePath,
} from './fetcher.ts';

const TARGET = {
  baseUrl: 'https://envs.example.com/prefix/',
  token: 'a'.repeat(40),
  client: 'cli',
};

/** Stubs fetch with one answer; returns the calls it got. */
function stubFetch(
  status = 200,
  body = '{"ok":true}',
  type = 'application/json; charset=utf-8',
) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(body || null, {
      status,
      headers: body ? { 'content-type': type } : {},
    });
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  setApiBasePath('');
});

describe('apiFetch', () => {
  it('keeps a request without a target relative, with no token header', async () => {
    const calls = stubFetch();
    const res = await getCheck({ strict: 'true' });
    expect(res).toMatchObject({ status: 200, data: { ok: true } });
    expect(calls[0]!.url).toBe('/api/check?strict=true');
    const headers = new Headers(calls[0]!.init.headers);
    expect(headers.has('authorization')).toBe(false);
    expect(headers.has(CLIENT_HEADER)).toBe(false);
    expect(calls[0]!.init.redirect).toBeUndefined();
  });

  it("sends a target's request to its URL with the token and the client", async () => {
    const calls = stubFetch();
    await fixGitignore({ strict: true }, { target: TARGET });
    const { url, init } = calls[0]!;
    expect(url).toBe('https://envs.example.com/prefix/api/check/gitignore');
    const headers = new Headers(init.headers);
    expect(headers.get('authorization')).toBe(`Bearer ${TARGET.token}`);
    expect(headers.get(CLIENT_HEADER)).toBe('cli');
    expect(headers.get('content-type')).toBe('application/json');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"strict":true}');
    expect(init.redirect).toBe('error');
    expect(init).not.toHaveProperty('target');
  });

  it('answers the status with an empty body for a body-less one', async () => {
    stubFetch(204, '');
    expect(await apiFetch('/api/x', { target: TARGET })).toMatchObject({
      status: 204,
      data: {},
    });
  });

  it('answers a body that is not JSON as its text, such as the event stream', async () => {
    const stream = 'event: changed\ndata: {"files":[]}\n\n';
    stubFetch(200, stream, 'text/event-stream');
    expect(await getEvents()).toMatchObject({ status: 200, data: stream });
  });
});

describe('the base path', () => {
  it('is empty by default: the server that serves the portal', () => {
    expect(apiBasePath()).toBe('');
  });

  it('prefixes every relative request, still same-origin and without a token header', async () => {
    const calls = stubFetch();
    setApiBasePath('/env/dev');
    await getCheck({ strict: 'true' });
    expect(calls[0]!.url).toBe('/env/dev/api/check?strict=true');
    const headers = new Headers(calls[0]!.init.headers);
    expect(headers.has('authorization')).toBe(false);
    expect(headers.has(CLIENT_HEADER)).toBe(false);
  });

  it('leaves a request marked local on the serving server', async () => {
    const calls = stubFetch();
    setApiBasePath('/env/dev');
    await getEnvironments({ local: true });
    expect(calls[0]!.url).toBe('/api/environments');
    expect(calls[0]!.init).not.toHaveProperty('local');
  });

  it("never applies to a target's request", async () => {
    const calls = stubFetch();
    setApiBasePath('/env/dev');
    await getCheck({}, { target: TARGET });
    expect(calls[0]!.url).toBe('https://envs.example.com/prefix/api/check');
  });

  it('is /env/<name> for an environment, encoded, and empty for local', () => {
    expect(environmentBasePath('local')).toBe('');
    expect(environmentBasePath('dev')).toBe('/env/dev');
    expect(environmentBasePath('a b')).toBe('/env/a%20b');
  });

  it('refuses a path that is not an absolute one without a trailing slash', () => {
    for (const path of ['env/dev', '/env/dev/', 'https://evil.example.com'])
      expect(() => setApiBasePath(path), path).toThrow();
  });
});
