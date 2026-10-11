import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { COLOR_GROUPS } from '../tokens';

import {
  customProperty,
  lengthToPx,
  parseThemeColors,
  radiusPx,
} from './token-math';

const SAMPLE = `
@theme static {
  --spacing-gutter: 1.5rem;
}
:root {
  color-scheme: light;
  --brand: oklch(0.49 0.2 268);
  --primary: var(--brand);
  --border: oklch(0.91 0.01 268);
  --radius: 0.75rem;

  @variant dark {
    color-scheme: dark;
    --brand: oklch(0.74 0.14 268);
    --border: oklch(1 0 0 / 10%);
  }
}
.other {
  --brand: red;
}
`;

describe('parseThemeColors', () => {
  it('reads each theme, resolving aliases within that theme', () => {
    const colors = parseThemeColors(SAMPLE);
    expect(colors.brand).toEqual({
      light: 'oklch(0.49 0.2 268)',
      dark: 'oklch(0.74 0.14 268)',
    });
    // `--primary` is only declared once, as an alias, so dark follows dark brand.
    expect(colors.primary).toEqual({
      light: 'oklch(0.49 0.2 268)',
      dark: 'oklch(0.74 0.14 268)',
    });
    expect(colors.border?.dark).toBe('oklch(1 0 0 / 10%)');
  });

  it('ignores non-color declarations and rules outside :root', () => {
    const colors = parseThemeColors(SAMPLE);
    expect(colors.radius).toBeUndefined();
    expect(colors['color-scheme']).toBeUndefined();
  });

  it('has a light and dark value for every catalogued color', () => {
    const css = readFileSync(
      resolve(import.meta.dirname, '../theme.css'),
      'utf8',
    );
    const colors = parseThemeColors(css);
    for (const token of COLOR_GROUPS.flatMap((group) => group.tokens)) {
      expect(colors[token.name]?.light, token.name).toMatch(/^oklch\(/);
      expect(colors[token.name]?.dark, token.name).toMatch(/^oklch\(/);
    }
  });
});

describe('customProperty', () => {
  it('returns the first declaration of a property', () => {
    expect(customProperty(SAMPLE, '--spacing-gutter')).toBe('1.5rem');
    expect(customProperty(SAMPLE, '--radius')).toBe('0.75rem');
    expect(customProperty(SAMPLE, '--missing')).toBeUndefined();
  });
});

describe('lengthToPx', () => {
  it('converts rem and px at a 16px root', () => {
    expect(lengthToPx('1.5rem')).toBe(24);
    expect(lengthToPx('6px')).toBe(6);
    expect(lengthToPx('auto')).toBeUndefined();
  });
});

describe('radiusPx', () => {
  it('scales the base radius by the expression', () => {
    expect(radiusPx('var(--radius)', 12)).toBe(12);
    expect(radiusPx('calc(var(--radius) * 0.6)', 12)).toBeCloseTo(7.2);
    expect(radiusPx('calc(var(--radius) * 2.6)', 12)).toBeCloseTo(31.2);
  });

  it('treats an infinite radius as a pill', () => {
    expect(radiusPx('calc(infinity * 1px)', 12)).toBe(Infinity);
  });

  it('returns undefined for an expression it does not know', () => {
    expect(radiusPx('min(1rem, 4vw)', 12)).toBeUndefined();
  });
});
