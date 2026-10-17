import { describe, expect, it, vi } from 'vite-plus/test';
import { consumeLaunchToken } from './launch';

function environment(href: string) {
  const history = { state: { key: 'k' }, replaceState: vi.fn() };
  const fetch = vi.fn(async () => new Response(null, { status: 200 }));
  return { location: { href }, history, fetch };
}

describe('consumeLaunchToken', () => {
  it('trades the token for the session cookie and cleans the URL', async () => {
    const env = environment(
      'http://127.0.0.1:4310/files?focus=.env&token=s3cr%2Bt#top',
    );

    expect(await consumeLaunchToken(env)).toBe(true);

    expect(env.history.replaceState).toHaveBeenCalledWith(
      { key: 'k' },
      '',
      '/files?focus=.env#top',
    );
    expect(env.fetch).toHaveBeenCalledWith('/launch?token=s3cr%2Bt', {
      credentials: 'same-origin',
      redirect: 'manual',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
  });

  it('cleans the URL before the trade, even when it fails', async () => {
    const env = environment('http://127.0.0.1:4310/?token=abc');
    env.fetch.mockRejectedValueOnce(new TypeError('offline'));

    expect(await consumeLaunchToken(env)).toBe(true);
    expect(env.history.replaceState).toHaveBeenCalledWith(
      { key: 'k' },
      '',
      '/',
    );
  });

  it('does nothing without a token', async () => {
    const env = environment('http://127.0.0.1:4310/variables');

    expect(await consumeLaunchToken(env)).toBe(false);
    expect(env.history.replaceState).not.toHaveBeenCalled();
    expect(env.fetch).not.toHaveBeenCalled();
  });
});
