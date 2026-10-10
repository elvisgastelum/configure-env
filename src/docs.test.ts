// The docs state the CLI's limits as plain numbers: they must match the
// constants, which docs cannot import.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  GENERATED_BYTES,
  GENERATED_LENGTH,
  MIN_GENERATED_BYTES,
  MIN_GENERATED_LENGTH,
} from './cli/generate.ts';
import { STDIN_IDLE_MS, STDIN_MAX_BYTES } from './cli/stdin.ts';

const doc = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const KIB = STDIN_MAX_BYTES / 1024;
const SECONDS = STDIN_IDLE_MS / 1000;

describe('the docs', () => {
  it('README states the generated length and the stdin limits', () => {
    const readme = doc('README.md');
    expect(readme).toContain(`${GENERATED_LENGTH} characters of`);
    expect(readme).toContain(`A \`maxLength\` under ${MIN_GENERATED_LENGTH}`);
    expect(readme).toContain(
      `never shorter than ${MIN_GENERATED_LENGTH} characters`,
    );
    expect(readme).toContain(
      `random bytes (${GENERATED_BYTES} when not set) in that encoding instead; \`bytes\` under ${MIN_GENERATED_BYTES}`,
    );
    expect(readme).toContain(
      `or ${MIN_GENERATED_BYTES} bytes with \`encoding\``,
    );
    expect(readme).toContain(`input past ${KIB} KiB`);
    expect(readme).toContain(`nothing new for ${SECONDS} seconds`);
  });

  it('the command reference states them too', () => {
    const commands = doc('skills/configure-env/references/commands.md');
    expect(commands).toContain(`a random ${GENERATED_LENGTH}-character`);
    expect(commands).toContain(
      `a \`maxLength\` under ${MIN_GENERATED_LENGTH} exits 2`,
    );
    expect(commands).toContain(
      `\`bytes\` random bytes (default ${GENERATED_BYTES}) in that encoding; \`bytes\` under ${MIN_GENERATED_BYTES} exits 2`,
    );
    expect(commands).toContain(`input past ${KIB} KiB`);
    expect(doc('skills/configure-env/references/schema.md')).toContain(
      `\`bytes\` random bytes (default ${GENERATED_BYTES})`,
    );
    expect(commands).toContain(`${SECONDS} s with no new input`);
  });
});
