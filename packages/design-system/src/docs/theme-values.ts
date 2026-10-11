import stylesheet from '../theme.css?raw';

import {
  customProperty,
  lengthToPx,
  parseThemeColors,
  type ThemeColor,
} from './token-math';

/** Every theme color's literal light and dark value, from `theme.css`. */
export const THEME_COLORS: Readonly<Record<string, ThemeColor>> =
  parseThemeColors(stylesheet);

/** A custom property's declared value in `theme.css`. */
export function declaredValue(name: string): string | undefined {
  return customProperty(stylesheet, name);
}

/** `--radius` in px; every radius step scales from it. */
export const RADIUS_BASE_PX = lengthToPx(declaredValue('--radius') ?? '') ?? 12;
