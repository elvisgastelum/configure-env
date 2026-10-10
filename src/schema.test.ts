import { describe, expect, it } from 'vitest';
import { validateValues } from './schema.ts';
import { DEFAULT_VALUES } from './template.ts';

describe('validateValues', () => {
  it('accepts the defaults', () => {
    expect(validateValues(DEFAULT_VALUES)).toEqual({
      ok: true,
      values: DEFAULT_VALUES,
    });
  });

  it.each([
    ['WEB_HOST', '192.168.1.70'],
    ['WEB_HOST', 'web.internal'],
    ['WEB_HOST', 'localhost'],
    ['WEB_PORT', '1'],
    ['WEB_PORT', '65535'],
    ['VITE_CONTACT_EMAIL', 'you@example.com'],
    ['VITE_CONTACT_WHATSAPP', '5215555555555'],
    ['VITE_CONTACT_WHATSAPP', 'off'],
  ])('accepts %s=%s', (key, value) => {
    expect(validateValues({ ...DEFAULT_VALUES, [key]: value }).ok).toBe(true);
  });

  it.each([
    ['WEB_HOST', ''],
    ['WEB_HOST', 'bad host'],
    ['WEB_HOST', '-leading.dash'],
    ['WEB_PORT', '0'],
    ['WEB_PORT', '65536'],
    ['WEB_PORT', '80a'],
    ['VITE_CONTACT_EMAIL', 'not-an-email'],
    ['VITE_CONTACT_WHATSAPP', '+52 638'],
    ['VITE_CONTACT_WHATSAPP', 'on'],
  ])('rejects %s=%s and names the key', (key, value) => {
    const result = validateValues({ ...DEFAULT_VALUES, [key]: value });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join('\n')).toContain(key);
  });
});
