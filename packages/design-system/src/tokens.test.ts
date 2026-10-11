import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import * as recipes from './recipes';
import * as tokens from './tokens';

// Read from disk: Vitest blanks CSS imports, `?raw` ones included.
const css = readFileSync(resolve(import.meta.dirname, './theme.css'), 'utf8');

/** Every custom property declared anywhere in theme.css (`--name:`). */
const DEFINED = new Set(
  [...css.matchAll(/(--[\w-]+)\s*:/g)].flatMap((match) => match[1] ?? []),
);

/** The custom properties declared in the light `:root` block. */
function rootColorProperties(): string[] {
  const start = css.indexOf(':root {');
  const end = css.indexOf('@variant dark', start);
  const block = css.slice(start, end);
  return [...block.matchAll(/(--[\w-]+)\s*:/g)]
    .flatMap((match) => match[1] ?? [])
    .filter((name) => name !== '--radius');
}

/** Every string anywhere inside a value, depth first. */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(strings);
  }
  return [];
}

describe('design-system tokens', () => {
  it('only references custom properties that theme.css defines', () => {
    const referenced = new Set(
      strings(tokens).flatMap((text) =>
        [...text.matchAll(/var\((--[\w-]+)/g)].flatMap(
          (match) => match[1] ?? [],
        ),
      ),
    );

    expect(referenced.size).toBeGreaterThan(0);
    for (const name of referenced) {
      expect(DEFINED, `${name} is not defined in theme.css`).toContain(name);
    }
  });

  it('catalogs every color the light theme defines', () => {
    const cataloged = new Set(
      tokens.COLOR_GROUPS.flatMap((group) =>
        group.tokens.map((token) => token.value),
      ),
    );
    const defined = rootColorProperties();

    expect(defined.length).toBeGreaterThan(10);
    for (const name of defined) {
      expect(cataloged, `${name} is missing from COLOR_GROUPS`).toContain(
        `var(${name})`,
      );
    }
  });

  it('gives every entry a name, a value and a description', () => {
    const lists = [
      ...tokens.COLOR_GROUPS.map((group) => group.tokens),
      tokens.RADIUS,
      tokens.SPACING,
      tokens.LAYOUT_WIDTHS,
      tokens.SHADOWS,
      tokens.BORDERS,
      tokens.RINGS,
      tokens.BLUR,
      tokens.Z_INDEX,
      tokens.OPACITY,
      tokens.FONT_FAMILIES,
      tokens.FONT_SIZES,
      tokens.FONT_WEIGHTS,
      tokens.TRACKING,
      tokens.TYPE_RECIPES,
      tokens.CSS_EASINGS,
      tokens.CSS_DURATIONS,
      tokens.KEYFRAMES,
      tokens.VIEW_TRANSITIONS,
      tokens.SPRINGS,
    ];

    for (const list of lists) {
      expect(list.length).toBeGreaterThan(0);
      for (const entry of list) {
        expect(entry.name).not.toBe('');
        expect(entry.value).not.toBe('');
        expect(entry.description).not.toBe('');
      }
    }
  });

  it('points every typography recipe at a TYPE recipe', () => {
    for (const entry of tokens.TYPE_RECIPES) {
      expect(Object.values(recipes.TYPE)).toContain(entry.value);
    }
  });
});

describe('design-system recipes', () => {
  it('are plain literal class strings Tailwind can scan', () => {
    const values = strings({ ...recipes, ctaClassName: undefined });

    expect(values.length).toBeGreaterThan(10);
    for (const value of values) {
      expect(value).not.toMatch(/\$\{|undefined|\[object/);
      expect(value.trim()).toBe(value);
      expect(value).not.toMatch(/\s{2,}/);
    }
  });

  it('keeps the CTA look working', () => {
    const className = recipes.ctaClassName('default', recipes.CTA_GLOW);

    expect(className).toContain('rounded-full');
    expect(className).toContain('shadow-primary/20');
  });
});
