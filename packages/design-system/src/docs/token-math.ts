/*
 * Reads token values out of the site stylesheet's text, so the docs can show
 * both themes side by side: the theme variables live on `:root` only, so a
 * `.dark` wrapper cannot repaint a swatch, but the literal values can.
 */

/** A color's literal value in each theme. */
export type ThemeColor = { light: string; dark: string };

const DECLARATION = /(--[\w-]+)\s*:\s*([^;]+);/g;
const ALIAS = /^var\((--[\w-]+)\)$/;

function declarations(block: string): Map<string, string> {
  return new Map(
    [...block.matchAll(DECLARATION)].map(([, name = '', value = '']) => [
      name,
      value.trim(),
    ]),
  );
}

/** Follows `var(--x)` aliases inside one theme's declarations. */
function resolveAliases(values: Map<string, string>): Map<string, string> {
  const resolveValue = (value: string, depth = 0): string => {
    const alias = ALIAS.exec(value)?.[1];
    const target = alias && values.get(alias);
    return target && depth < 8 ? resolveValue(target, depth + 1) : value;
  };
  return new Map(
    [...values].map(([name, value]) => [name, resolveValue(value)]),
  );
}

/**
 * Every color the `:root` block declares, by name without the `--`, with
 * its light value and its dark value (the `@variant dark` overrides on top
 * of light). Non-color declarations such as `--radius` are left out.
 */
export function parseThemeColors(css: string): Record<string, ThemeColor> {
  const start = css.indexOf(':root {');
  const darkStart = css.indexOf('@variant dark', start);
  const darkEnd = css.indexOf('}', darkStart);
  if (start < 0 || darkStart < 0) return {};

  const lightRaw = declarations(css.slice(start, darkStart));
  const darkRaw = new Map([
    ...lightRaw,
    ...declarations(css.slice(darkStart, darkEnd)),
  ]);
  const light = resolveAliases(lightRaw);
  const dark = resolveAliases(darkRaw);

  const colors: Record<string, ThemeColor> = {};
  for (const [name, value] of light) {
    const darkValue = dark.get(name) ?? value;
    if (!value.startsWith('oklch(')) continue;
    colors[name.slice(2)] = { light: value, dark: darkValue };
  }
  return colors;
}

/** The value of the first declaration of `name` (with its `--`). */
export function customProperty(css: string, name: string): string | undefined {
  for (const [, declared, value] of css.matchAll(DECLARATION)) {
    if (declared === name) return value?.trim();
  }
  return undefined;
}

/** A `rem` or `px` length in px, at the browser's default 16px root. */
export function lengthToPx(length: string): number | undefined {
  const match = /^(-?[\d.]+)(rem|px)$/.exec(length.trim());
  if (!match) return undefined;
  const amount = Number(match[1]);
  return match[2] === 'rem' ? amount * 16 : amount;
}

/**
 * The px a radius step resolves to, from its expression in terms of
 * `--radius` (`basePx`). `Infinity` is a pill.
 */
export function radiusPx(
  expression: string,
  basePx: number,
): number | undefined {
  if (expression === 'var(--radius)') return basePx;
  if (expression.startsWith('calc(infinity')) return Infinity;
  const factor = /^calc\(var\(--radius\) \* ([\d.]+)\)$/.exec(expression)?.[1];
  return factor === undefined ? undefined : basePx * Number(factor);
}
