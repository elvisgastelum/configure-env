import type { CSSProperties } from 'react';

import type { RadiusToken, TokenEntry } from '../tokens';
import { cn } from '../lib/utils';

import { CopyCode, RichText } from './code';
import { DocTable } from './table';
import { declaredValue, RADIUS_BASE_PX } from './theme-values';
import { lengthToPx, radiusPx } from './token-math';

/*
 * Live samples for the foundations pages. They render with the site's own
 * classes and variables, so they follow the toolbar's theme.
 */

const px = (value: number) =>
  `${Number.isInteger(value) ? value : value.toFixed(1)}px`;

/** Every radius step as a box, with its expression and size in px. */
export function RadiusScale({ tokens }: { tokens: readonly RadiusToken[] }) {
  return (
    <div className="sb-unstyled my-6 grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-4">
      {tokens.map((token) => {
        const size = radiusPx(token.expression, RADIUS_BASE_PX);
        return (
          <figure
            key={token.name}
            className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 text-card-foreground"
          >
            <span
              className={cn(
                'block h-20 border-2 border-primary/60 bg-accent',
                token.utility,
              )}
            />
            <figcaption className="flex flex-col gap-1 text-sm">
              <span className="font-medium">
                {token.name}{' '}
                <span className="font-normal text-muted-foreground">
                  {size === undefined
                    ? ''
                    : size === Infinity
                      ? '· pill'
                      : `· ${px(size)}`}
                </span>
              </span>
              <CopyCode>{token.utility}</CopyCode>
              <span className="font-mono text-[0.6875rem] break-words text-muted-foreground">
                {token.expression}
              </span>
              <span className="text-xs text-muted-foreground">
                <RichText>{token.description}</RichText>
              </span>
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}

/** The custom property a `var(--x)` value names, e.g. `--spacing-gutter`. */
const propertyOf = (value: string) => /^var\((--[\w-]+)\)$/.exec(value)?.[1];

/** Named spacing as bars at their real length. */
export function SpacingScale({ entries }: { entries: readonly TokenEntry[] }) {
  return (
    <DocTable
      minWidth="36rem"
      headers={['Token', 'Size', 'Bar', 'Used for']}
      rows={entries.map((entry) => {
        const property = propertyOf(entry.value);
        const declared = property && declaredValue(property);
        const size = declared && lengthToPx(declared);
        return [
          <span className="flex flex-col items-start gap-1">
            <span className="font-medium">{entry.name}</span>
            <CopyCode>{entry.value}</CopyCode>
          </span>,
          <span className="whitespace-nowrap">
            {declared}
            {size ? ` · ${px(size)}` : ''}
          </span>,
          <span
            className="block h-4 rounded-sm bg-primary"
            style={{ width: entry.value }}
          />,
          <span className="text-muted-foreground">
            <RichText>{entry.description}</RichText>
          </span>,
        ];
      })}
    />
  );
}

/**
 * Tailwind v4's container widths, in rem, for the `max-w-*` classes the
 * layout uses (the catalog names the class, not its size).
 */
const MAX_WIDTH_REM: Record<string, number> = {
  'max-w-2xl': 42,
  'max-w-4xl': 56,
  'max-w-5xl': 64,
  'max-w-6xl': 72,
};

/** Layout widths as bars scaled against the widest one. */
export function WidthScale({ entries }: { entries: readonly TokenEntry[] }) {
  const widest = Math.max(
    ...entries.map((entry) => MAX_WIDTH_REM[entry.value] ?? 0),
  );
  return (
    <div className="sb-unstyled my-6 flex flex-col gap-4 rounded-xl border border-border bg-card p-4 text-card-foreground">
      {entries.map((entry) => {
        const rem = MAX_WIDTH_REM[entry.value];
        return (
          <div key={entry.name} className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
              <span className="font-medium">{entry.name}</span>
              <CopyCode>{entry.value}</CopyCode>
              {rem && (
                <span className="text-muted-foreground">
                  {rem}rem · {rem * 16}px
                </span>
              )}
            </div>
            <span
              className="block h-3 rounded-full bg-primary/70"
              style={{ width: rem ? `${(rem / widest) * 100}%` : '100%' }}
            />
            <span className="text-xs text-muted-foreground">
              <RichText>{entry.description}</RichText>
            </span>
          </div>
        );
      })}
      <p className="text-xs text-muted-foreground">
        Bars are scaled to the widest (72rem), which is wider than this page.
      </p>
    </div>
  );
}

/** How to show a shadow entry on a card: tints need a shadow size to tint. */
function shadowLook(value: string): {
  className?: string;
  style?: CSSProperties;
} {
  if (value.startsWith('var(')) return { style: { boxShadow: value } };
  if (value.startsWith('shadow-primary/'))
    return { className: cn('shadow-lg', value) };
  if (value.startsWith('shadow-foreground/'))
    return { className: cn('shadow-sm', value) };
  return { className: value };
}

/** Every shadow on a card sample. */
export function ShadowGrid({ entries }: { entries: readonly TokenEntry[] }) {
  return (
    <div className="sb-unstyled my-6 grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-6 rounded-xl bg-muted/40 p-6">
      {entries.map((entry) => {
        const look = shadowLook(entry.value);
        return (
          <figure key={entry.name} className="flex flex-col gap-3">
            <span
              className={cn('block h-24 rounded-2xl bg-card', look.className)}
              style={look.style}
            />
            <figcaption className="flex flex-col items-start gap-1 text-sm">
              <span className="font-medium">{entry.name}</span>
              <CopyCode>{entry.value}</CopyCode>
              <span className="text-xs text-muted-foreground">
                <RichText>{entry.description}</RichText>
              </span>
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}

/**
 * Borders and rings on sample cards. Variant-only entries get what they
 * need to show: a hover hint, `aria-invalid`, or keyboard focus.
 */
export function OutlineGrid({
  entries,
  kind,
}: {
  entries: readonly TokenEntry[];
  kind: 'border' | 'ring';
}) {
  return (
    <div className="sb-unstyled my-6 grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-4">
      {entries.map((entry) => {
        const invalid = entry.value.includes('aria-invalid:');
        const hover = entry.value.includes('hover:');
        const focus = entry.value.includes('focus-visible:');
        const base =
          kind === 'border'
            ? 'border'
            : cn(
                !focus && 'ring-1 ring-foreground/10',
                invalid && 'aria-invalid:ring-3',
                entry.value.startsWith('outline-') &&
                  'outline-2 outline-offset-2',
              );
        return (
          <figure key={entry.name} className="flex flex-col gap-3">
            <span
              tabIndex={focus ? 0 : undefined}
              aria-invalid={invalid || undefined}
              className={cn(
                'grid h-20 place-items-center rounded-xl bg-card px-3 text-center text-xs text-muted-foreground outline-none',
                base,
                entry.value,
              )}
            >
              {focus
                ? 'Tab here'
                : hover
                  ? 'Hover me'
                  : invalid
                    ? 'aria-invalid'
                    : null}
            </span>
            <figcaption className="flex flex-col items-start gap-1 text-sm">
              <span className="font-medium">{entry.name}</span>
              <CopyCode>{entry.value}</CopyCode>
              <span className="text-xs text-muted-foreground">
                <RichText>{entry.description}</RichText>
              </span>
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}

/**
 * The stacking layers as a stacked diagram: the highest layer on top, the
 * page content (z-0) between the layers above it and the one behind it.
 */
export function ZIndexStack({ entries }: { entries: readonly TokenEntry[] }) {
  const page: TokenEntry = {
    name: 'page content',
    value: 'z-0',
    description: 'Everything without a z-index.',
  };
  const behind = entries.filter((entry) => entry.value.startsWith('-'));
  const above = entries.filter((entry) => !entry.value.startsWith('-'));
  const layers = [...above].reverse().concat(page, [...behind].reverse());
  return (
    <ol className="sb-unstyled my-6 flex flex-col gap-2 rounded-xl border border-border bg-muted/40 p-4 sm:p-6">
      {layers.map((entry, index) => (
        <li
          key={entry.name}
          className={cn(
            'flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-xl border bg-card px-4 py-3 text-sm text-card-foreground',
            entry === page
              ? 'border-dashed border-border'
              : 'border-border shadow-sm',
          )}
          style={{ marginInline: `${index * 0.75}rem` }}
        >
          <span className="font-mono text-xs font-semibold text-primary">
            {entry.value}
          </span>
          <span className="font-medium">{entry.name}</span>
          <span className="text-xs text-muted-foreground">
            <RichText>{entry.description}</RichText>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Each radial glow, unblurred, on the page background. */
export function GlowGrid({ entries }: { entries: readonly TokenEntry[] }) {
  return (
    <div className="sb-unstyled my-6 grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-4">
      {entries.map((entry) => (
        <figure key={entry.name} className="flex flex-col gap-3">
          <span className="relative block h-40 overflow-hidden rounded-2xl border border-border bg-background">
            <span
              className={cn('absolute inset-4 rounded-full', entry.value)}
            />
          </span>
          <figcaption className="flex flex-col items-start gap-1 text-sm">
            <span className="font-medium">{entry.name}</span>
            <span className="text-xs text-muted-foreground">
              <RichText>{entry.description}</RichText>
            </span>
            <CopyCode>{entry.value}</CopyCode>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

/** Blurs: element blurs on a brand blob; backdrop blurs over a pattern. */
export function BlurGrid({ entries }: { entries: readonly TokenEntry[] }) {
  return (
    <div className="sb-unstyled my-6 grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-4">
      {entries.map((entry) => {
        const backdrop = entry.value.startsWith('backdrop-');
        return (
          <figure key={entry.name} className="flex flex-col gap-3">
            <span className="relative grid h-32 place-items-center overflow-hidden rounded-2xl border border-border bg-background">
              {backdrop ? (
                <>
                  <span className="absolute inset-0 grid grid-cols-6 gap-2 p-3 text-xs font-semibold text-primary">
                    {Array.from({ length: 18 }, (_, index) => (
                      <span key={index}>Aa</span>
                    ))}
                  </span>
                  <span
                    className={cn(
                      'relative h-14 w-36 rounded-xl border border-border/60 bg-background/70',
                      entry.value,
                    )}
                  />
                </>
              ) : (
                <span
                  className={cn('size-20 rounded-full bg-primary', entry.value)}
                />
              )}
            </span>
            <figcaption className="flex flex-col items-start gap-1 text-sm">
              <span className="font-medium">{entry.name}</span>
              <CopyCode>{entry.value}</CopyCode>
              <span className="text-xs text-muted-foreground">
                <RichText>{entry.description}</RichText>
              </span>
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}
