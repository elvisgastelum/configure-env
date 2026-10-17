import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { getCheck, fixGitignore } from './client.ts';
import { CLIENT_HEADER, apiFetch } from './fetcher.ts';

const TARGET = {
  baseUrl: 'https://envs.example.com/prefix/',
  token: 'a'.repeat(40),
  client: 'cli',
};

/** Stubs fetch with one answer; returns the calls it got. */
function stubFetch(status = 200, body = '{"ok":true}') {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(body || null, { status });
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
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
});
