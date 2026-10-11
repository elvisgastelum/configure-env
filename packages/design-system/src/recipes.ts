import { buttonVariants } from './components/atoms/button';
import { cn } from './lib/utils';

/*
 * Shared class recipes: the class sets the site repeats, named once. Each is
 * a plain literal so Tailwind, which scans source text, still sees every
 * class; never build one from pieces at runtime.
 */

/** The site's text styles, from the hero headline down to small print. */
export const TYPE = {
  /** The home hero's headline, the largest text on the site. */
  display:
    'text-4xl leading-[1.05] font-bold tracking-tight text-balance sm:text-6xl lg:text-7xl',
  /** A standalone page's h1, such as the contact page's. */
  pageTitle: 'text-4xl font-bold tracking-tight text-balance sm:text-5xl',
  /** A landing section's title (its page's h1 when the section is the page). */
  sectionTitle:
    'text-3xl font-semibold tracking-tight text-balance md:text-4xl',
  /** A heading inside a section: FAQ, CTA band, about blocks. */
  subTitle: 'text-2xl font-semibold tracking-tight text-balance md:text-3xl',
  /** A contact step's heading; it grows from `sm` because the form is narrow. */
  stepTitle: 'text-2xl font-semibold tracking-tight text-balance sm:text-3xl',
  /** A card's heading. */
  cardTitle: 'text-lg font-semibold tracking-tight text-balance',
  /** The short brand-colored label above a heading. */
  eyebrow: 'text-sm font-semibold tracking-wide text-primary',
  /** The paragraph that introduces a section or page. */
  lead: 'text-lg text-pretty text-muted-foreground',
  /** Secondary small text: captions, hints, meta. */
  small: 'text-sm text-muted-foreground',
} as const;

/** The primary CTA's brand glow, which grows as the pointer arrives. */
export const CTA_GLOW =
  'shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30';

/** The house keyboard focus ring for anything interactive. */
export const FOCUS_RING = 'focus-visible:ring-3 focus-visible:ring-ring/50';

/** The page-width column every section's content sits in. */
export const CONTAINER = 'mx-auto w-full max-w-6xl px-gutter';

/** The vertical breathing room between two page sections. */
export const SECTION_RHYTHM = 'py-section md:py-section-lg';

/** A muted band that sets a section apart from its neighbours. */
export const MUTED_BAND = 'border-y border-border/60 bg-muted/40';

/** The faint outline that draws a card's edge on any surface. */
export const CARD_OUTLINE = 'ring-1 ring-foreground/10';

/**
 * Button look for call-to-action links, sized for touch. It lifts a little
 * on hover and presses in when tapped (transforms only, and only when the
 * visitor allows motion).
 */
export function ctaClassName(
  variant: 'default' | 'outline',
  className?: string,
): string {
  return cn(
    buttonVariants({ variant }),
    'h-12 rounded-full px-6 text-base duration-200 ease-out motion-safe:hover:-translate-y-0.5 motion-safe:active:scale-[0.98]',
    className,
  );
}

/**
 * A card that answers the pointer and the keyboard: on hover, or while
 * something inside it has keyboard focus, it lifts, casts a soft shadow
 * and its border picks up the brand color. Only the lift moves, and only
 * when the visitor allows motion.
 */
export const INTERACTIVE_CARD =
  'transition-[translate,box-shadow] duration-300 ease-out hover:shadow-lg hover:shadow-primary/10 hover:ring-primary/40 has-[:focus-visible]:shadow-lg has-[:focus-visible]:shadow-primary/10 has-[:focus-visible]:ring-primary/40 motion-safe:hover:-translate-y-1 motion-safe:has-[:focus-visible]:-translate-y-1';
