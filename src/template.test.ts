import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VALUES,
  EXAMPLE_KEYS,
  renderExampleBlock,
  renderProductionExample,
} from './template.ts';

// The heredoc of the retired scripts/configure-env.sh, byte for byte. Only
// the header lines naming the template's location are meant to differ.
const bashOutput = readFile(
  new URL('./fixtures/bash-production-template.txt', import.meta.url),
  'utf8',
);

describe('renderProductionExample', () => {
  it('matches the bash template byte for byte, apart from the template location', async () => {
    const expected = (await bashOutput).replace(
      '# scripts/configure-env.sh, not this file, which the script rewrites.\n',
      '# packages/configure-env/src/template.ts, not this file, which the tool\n# rewrites.\n',
    );
    expect(expected).not.toBe(await bashOutput);
    expect(renderProductionExample()).toBe(expected);
  });

  it('keeps the key lines of the homelab settings', () => {
    const lines = renderProductionExample().split('\n');
    expect(lines).toContain('CADDY_ADDRESS=192.168.1.70');
    expect(lines).toContain('WEB_HOST=192.168.1.<CT ID>');
    expect(lines).toContain('WEB_PORT=8080');
    expect(lines).toContain(
      'COMPOSE_FILE=docker-compose.yml:deploy/compose.prod.yml',
    );
    expect(renderProductionExample()).toContain('pnpm configure:env');
    expect(renderProductionExample().endsWith('\n')).toBe(true);
  });
});

describe('renderExampleBlock', () => {
  it('renders every key with its comment and default, groups separated by a blank line', () => {
    expect(renderExampleBlock(EXAMPLE_KEYS)).toBe(
      [
        '# Address the web container is published on; keep 127.0.0.1 behind a reverse proxy on the same host.',
        'WEB_HOST=127.0.0.1',
        '',
        '# Host port the site is published on.',
        'WEB_PORT=8080',
        '',
        '# Contact details embedded in the bundle at build time (README, "Contact variables").',
        '# Empty keeps the defaults in apps/web/src/config/site.ts; VITE_CONTACT_WHATSAPP=off hides WhatsApp.',
        'VITE_CONTACT_EMAIL=',
        'VITE_CONTACT_WHATSAPP=',
        '',
      ].join('\n'),
    );
  });

  it('writes the contact comment once, before the first contact key', () => {
    const block = renderExampleBlock(['VITE_CONTACT_WHATSAPP', 'WEB_PORT']);
    expect(block).toBe(
      [
        '# Contact details embedded in the bundle at build time (README, "Contact variables").',
        '# Empty keeps the defaults in apps/web/src/config/site.ts; VITE_CONTACT_WHATSAPP=off hides WhatsApp.',
        'VITE_CONTACT_WHATSAPP=',
        '',
        '# Host port the site is published on.',
        'WEB_PORT=8080',
        '',
      ].join('\n'),
    );
  });

  it('uses the given values instead of the defaults', () => {
    const block = renderExampleBlock(EXAMPLE_KEYS, {
      ...DEFAULT_VALUES,
      WEB_PORT: '9000',
      VITE_CONTACT_WHATSAPP: 'off',
    });
    expect(block).toContain('\nWEB_PORT=9000\n');
    expect(block).toContain('\nVITE_CONTACT_WHATSAPP=off\n');
    expect(block).toContain('WEB_HOST=127.0.0.1\n');
  });
});
