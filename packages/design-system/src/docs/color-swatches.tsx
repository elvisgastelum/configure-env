import type { CSSProperties } from 'react';

import type { ColorGroup, TokenEntry } from '../tokens';

import { Code, CopyCode, RichText } from './code';
import { DocTable } from './table';
import { THEME_COLORS } from './theme-values';

/**
 * One color on its theme's page background, so translucent colors (the
 * dark borders are white at 10%) show as they really do.
 */
function Swatch({
  color,
  surface,
  edge,
  caption,
}: {
  color: string;
  surface: string;
  edge: string;
  caption?: string;
}) {
  return (
    <span className="flex w-24 flex-col gap-1.5">
      <span
        className="block h-12 rounded-lg p-1.5"
        style={{ background: surface, boxShadow: `inset 0 0 0 1px ${edge}` }}
        title={caption ?? color}
      >
        <span
          className="block size-full rounded-md"
          style={{ background: color, boxShadow: `0 0 0 1px ${edge}` }}
        />
      </span>
      {caption && (
        <span className="font-mono text-[0.6875rem] leading-tight break-words text-muted-foreground">
          {caption}
        </span>
      )}
    </span>
  );
}

const LIGHT_EDGE = 'oklch(0 0 0 / 10%)';
const DARK_EDGE = 'oklch(1 0 0 / 15%)';

/**
 * A color group as a table: the light and dark values side by side, then a
 * live swatch that follows the toolbar's theme.
 */
export function ColorGroupTable({ group }: { group: ColorGroup }) {
  const page = THEME_COLORS.background;
  return (
    <DocTable
      minWidth="52rem"
      headers={['Light', 'Dark', 'Current', 'Token', 'Used for']}
      rows={group.tokens.map((token) => {
        const literal = THEME_COLORS[token.name];
        return [
          literal ? (
            <Swatch
              color={literal.light}
              surface={page?.light ?? 'white'}
              edge={LIGHT_EDGE}
              caption={literal.light}
            />
          ) : (
            '—'
          ),
          literal ? (
            <Swatch
              color={literal.dark}
              surface={page?.dark ?? 'black'}
              edge={DARK_EDGE}
              caption={literal.dark}
            />
          ) : (
            '—'
          ),
          <Swatch
            color={token.value}
            surface="var(--background)"
            edge="color-mix(in oklch, var(--foreground) 12%, transparent)"
          />,
          <span className="flex flex-col items-start gap-1">
            <span className="font-medium">{token.name}</span>
            <CopyCode>{`--${token.name}`}</CopyCode>
            <CopyCode>{`bg-${token.utility}`}</CopyCode>
          </span>,
          <span className="flex flex-col gap-1.5">
            <span>
              <RichText>{token.description}</RichText>
            </span>
            <span className="text-xs text-muted-foreground">
              <strong className="font-medium text-foreground">Light:</strong>{' '}
              <RichText>{token.light}</RichText>
            </span>
            <span className="text-xs text-muted-foreground">
              <strong className="font-medium text-foreground">Dark:</strong>{' '}
              <RichText>{token.dark}</RichText>
            </span>
          </span>,
        ];
      })}
    />
  );
}

/** The opacity modifier as a share, e.g. `/40` → 40, `/[0.03]` → 3. */
function percent(entry: TokenEntry): number {
  const amount = Number(entry.name);
  return amount < 1 ? amount * 100 : amount;
}

/**
 * Each opacity modifier applied to primary and foreground, the same
 * `color-mix` Tailwind writes for `bg-primary/40`.
 */
export function OpacityScale({ entries }: { entries: readonly TokenEntry[] }) {
  const tint = (color: string, entry: TokenEntry): CSSProperties => ({
    background: `color-mix(in oklch, var(${color}) ${percent(entry)}%, transparent)`,
  });
  return (
    <DocTable
      minWidth="36rem"
      headers={['Primary', 'Foreground', 'Modifier', 'Used for']}
      rows={entries.map((entry) => [
        <span
          className="block h-8 w-16 rounded-md ring-1 ring-foreground/10"
          style={tint('--primary', entry)}
        />,
        <span
          className="block h-8 w-16 rounded-md ring-1 ring-foreground/10"
          style={tint('--foreground', entry)}
        />,
        <Code>{entry.value}</Code>,
        <span className="text-muted-foreground">
          <RichText>{entry.description}</RichText>
        </span>,
      ])}
    />
  );
}
