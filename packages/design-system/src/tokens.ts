import { TYPE } from './recipes';

/*
 * The design system's catalog: every token the site uses, named and
 * explained, for the Storybook foundations docs to render. A `value` that is
 * a CSS custom property names one defined in `theme.css` (a test keeps
 * them in step); any other `value` is the Tailwind class that applies it.
 */

/** One design token: what it is called, how to apply it, and why. */
export type TokenEntry = {
  name: string;
  value: string;
  description: string;
};

/** A color, with how it behaves in each theme. */
export type ColorToken = TokenEntry & {
  /** The Tailwind color name (`bg-<utility>`, `text-<utility>`, ...). */
  utility: string;
  light: string;
  dark: string;
};

/** A family of colors that share a job. */
export type ColorGroup = {
  id: 'surface' | 'text' | 'brand' | 'accent' | 'feedback' | 'lines';
  label: string;
  description: string;
  tokens: readonly ColorToken[];
};

/** A radius step and the expression it derives from `--radius`. */
export type RadiusToken = TokenEntry & { utility: string; expression: string };

/**
 * A spring transition, as motion's `transition` prop takes it. `source` is
 * the package module that uses it, or `app` for a spring an app sets on its
 * own components with these values.
 */
export type SpringToken = TokenEntry & { source: string };

/* ------------------------------------------------------------------ */
/* Color                                                               */
/* ------------------------------------------------------------------ */

/** Every theme color, grouped by job; all of them switch with the theme. */
export const COLOR_GROUPS: readonly ColorGroup[] = [
  {
    id: 'surface',
    label: 'Surfaces',
    description: 'What content sits on, from the page to raised panels.',
    tokens: [
      {
        name: 'background',
        value: 'var(--background)',
        utility: 'background',
        description: 'The page itself.',
        light: 'Near white, a breath of the brand hue.',
        dark: 'Deep blue-black.',
      },
      {
        name: 'card',
        value: 'var(--card)',
        utility: 'card',
        description: 'Cards and raised panels.',
        light: 'Pure white, a touch above the page.',
        dark: 'A step lighter than the page.',
      },
      {
        name: 'popover',
        value: 'var(--popover)',
        utility: 'popover',
        description: 'Menus and floating layers.',
        light: 'Same as card.',
        dark: 'Same as card.',
      },
      {
        name: 'secondary',
        value: 'var(--secondary)',
        utility: 'secondary',
        description: 'Secondary buttons and quiet fills.',
        light: 'Pale brand-tinted grey.',
        dark: 'Dark brand-tinted grey.',
      },
      {
        name: 'muted',
        value: 'var(--muted)',
        utility: 'muted',
        description: 'Muted bands, chips and hover fills.',
        light: 'Pale grey; used at /40 for section bands.',
        dark: 'Dark grey between page and card.',
      },
    ],
  },
  {
    id: 'text',
    label: 'Text',
    description: 'Text on each surface; every pair keeps WCAG AA contrast.',
    tokens: [
      {
        name: 'foreground',
        value: 'var(--foreground)',
        utility: 'foreground',
        description: 'Body text and headings.',
        light: 'Near black, brand-tinted.',
        dark: 'Near white.',
      },
      {
        name: 'card-foreground',
        value: 'var(--card-foreground)',
        utility: 'card-foreground',
        description: 'Text on cards.',
        light: 'Same as foreground.',
        dark: 'Same as foreground.',
      },
      {
        name: 'popover-foreground',
        value: 'var(--popover-foreground)',
        utility: 'popover-foreground',
        description: 'Text on popovers.',
        light: 'Same as foreground.',
        dark: 'Same as foreground.',
      },
      {
        name: 'secondary-foreground',
        value: 'var(--secondary-foreground)',
        utility: 'secondary-foreground',
        description: 'Text on secondary fills.',
        light: 'Dark brand-tinted grey.',
        dark: 'Near white.',
      },
      {
        name: 'muted-foreground',
        value: 'var(--muted-foreground)',
        utility: 'muted-foreground',
        description: 'Leads, captions and secondary text.',
        light: 'Mid grey, 4.5:1 or more on page and cards.',
        dark: 'Light grey, 4.5:1 or more on page and cards.',
      },
    ],
  },
  {
    id: 'brand',
    label: 'Brand and primary',
    description: 'The indigo that carries buttons, links and highlights.',
    tokens: [
      {
        name: 'brand',
        value: 'var(--brand)',
        utility: 'brand',
        description: 'The brand accent; glows mix it with transparency.',
        light: 'Deep indigo; white text on it is about 6:1.',
        dark: 'Lighter indigo that reads on the dark page.',
      },
      {
        name: 'brand-foreground',
        value: 'var(--brand-foreground)',
        utility: 'brand-foreground',
        description: 'Text and icons on the brand color.',
        light: 'Near white.',
        dark: 'Deep indigo-black.',
      },
      {
        name: 'primary',
        value: 'var(--primary)',
        utility: 'primary',
        description:
          'Primary actions, links, eyebrows; an alias of brand. Often tinted (/5 to /40) for shadows, borders and rings.',
        light: 'Follows brand.',
        dark: 'Follows brand.',
      },
      {
        name: 'primary-foreground',
        value: 'var(--primary-foreground)',
        utility: 'primary-foreground',
        description: 'Text on primary buttons; an alias of brand-foreground.',
        light: 'Follows brand-foreground.',
        dark: 'Follows brand-foreground.',
      },
    ],
  },
  {
    id: 'accent',
    label: 'Accent',
    description: 'Soft brand tints for selected and hovered states.',
    tokens: [
      {
        name: 'accent',
        value: 'var(--accent)',
        utility: 'accent',
        description: 'Selected options and hover backgrounds.',
        light: 'Pale indigo wash.',
        dark: 'Dark indigo wash.',
      },
      {
        name: 'accent-foreground',
        value: 'var(--accent-foreground)',
        utility: 'accent-foreground',
        description: 'Text on accent.',
        light: 'Deep indigo.',
        dark: 'Pale indigo.',
      },
    ],
  },
  {
    id: 'feedback',
    label: 'Feedback',
    description: 'States that need attention.',
    tokens: [
      {
        name: 'destructive',
        value: 'var(--destructive)',
        utility: 'destructive',
        description:
          'Errors and invalid fields (border, and a /20 ring; /40 in dark).',
        light: 'Strong red.',
        dark: 'Lighter red that reads on the dark page.',
      },
    ],
  },
  {
    id: 'lines',
    label: 'Lines',
    description: 'Borders, field outlines and the focus ring.',
    tokens: [
      {
        name: 'border',
        value: 'var(--border)',
        utility: 'border',
        description: 'Default border color (every element gets it in base).',
        light: 'Light brand-tinted grey.',
        dark: 'White at 10%.',
      },
      {
        name: 'input',
        value: 'var(--input)',
        utility: 'input',
        description: 'Form field borders.',
        light: 'Same as border.',
        dark: 'White at 15%, a little stronger than border.',
      },
      {
        name: 'ring',
        value: 'var(--ring)',
        utility: 'ring',
        description: 'Focus rings (at /50) and the base outline color.',
        light: 'Mid indigo.',
        dark: 'Same as brand.',
      },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Radius                                                              */
/* ------------------------------------------------------------------ */

/** The base every radius step scales from. */
export const RADIUS_BASE: TokenEntry = {
  name: 'radius',
  value: 'var(--radius)',
  description: '0.75rem; change it and every rounded corner follows.',
};

/** The radius scale, each step a multiple of `--radius`. */
export const RADIUS: readonly RadiusToken[] = [
  {
    name: 'sm',
    value: 'var(--radius-sm)',
    utility: 'rounded-sm',
    expression: 'calc(var(--radius) * 0.6)',
    description: 'Tight corners: inline links and small focus targets.',
  },
  {
    name: 'md',
    value: 'var(--radius-md)',
    utility: 'rounded-md',
    expression: 'calc(var(--radius) * 0.8)',
    description: 'Small controls: logo link, skip link.',
  },
  {
    name: 'lg',
    value: 'var(--radius-lg)',
    utility: 'rounded-lg',
    expression: 'var(--radius)',
    description: 'Buttons (the base radius).',
  },
  {
    name: 'xl',
    value: 'var(--radius-xl)',
    utility: 'rounded-xl',
    expression: 'calc(var(--radius) * 1.4)',
    description: 'Form fields, small cards.',
  },
  {
    name: '2xl',
    value: 'var(--radius-2xl)',
    utility: 'rounded-2xl',
    expression: 'calc(var(--radius) * 1.8)',
    description: 'Content cards, FAQ items.',
  },
  {
    name: '3xl',
    value: 'var(--radius-3xl)',
    utility: 'rounded-3xl',
    expression: 'calc(var(--radius) * 2.2)',
    description: 'The contact form panel.',
  },
  {
    name: '4xl',
    value: 'var(--radius-4xl)',
    utility: 'rounded-4xl',
    expression: 'calc(var(--radius) * 2.6)',
    description: 'Badges.',
  },
  {
    name: 'full',
    value: 'rounded-full',
    utility: 'rounded-full',
    expression: 'calc(infinity * 1px)',
    description: 'Pills: CTAs, chips, nav links, glows.',
  },
];

/* ------------------------------------------------------------------ */
/* Spacing and layout                                                  */
/* ------------------------------------------------------------------ */

/** The site's named spacing, on top of Tailwind's 0.25rem scale. */
export const SPACING: readonly TokenEntry[] = [
  {
    name: 'gutter',
    value: 'var(--spacing-gutter)',
    description: '1.5rem of horizontal page padding (`px-gutter`).',
  },
  {
    name: 'section',
    value: 'var(--spacing-section)',
    description: '5rem between page sections on small screens (`py-section`).',
  },
  {
    name: 'section-lg',
    value: 'var(--spacing-section-lg)',
    description: '8rem between page sections from `md` (`md:py-section-lg`).',
  },
];

/** The widths that shape the page and keep text readable. */
export const LAYOUT_WIDTHS: readonly TokenEntry[] = [
  {
    name: 'container',
    value: 'max-w-6xl',
    description: 'The page column (72rem), centred with the gutter.',
  },
  {
    name: 'glow',
    value: 'max-w-5xl',
    description: 'The width of the decorative glows behind a page top.',
  },
  {
    name: 'headline',
    value: 'max-w-4xl',
    description: 'The hero headline, so it breaks into a few long lines.',
  },
  {
    name: 'measure',
    value: 'max-w-2xl',
    description: 'Section headers and leads: a comfortable reading measure.',
  },
];

/* ------------------------------------------------------------------ */
/* Elevation                                                           */
/* ------------------------------------------------------------------ */

/** Shadows: Tailwind's scale, brand-tinted modifiers and two named ones. */
export const SHADOWS: readonly TokenEntry[] = [
  {
    name: 'xs',
    value: 'shadow-xs',
    description: 'Form fields, barely lifted.',
  },
  {
    name: 'sm',
    value: 'shadow-sm',
    description: 'The scrolled header bar (with the hairline tint below).',
  },
  {
    name: 'md',
    value: 'shadow-md',
    description: 'Option cards on hover and when selected.',
  },
  {
    name: 'lg',
    value: 'shadow-lg',
    description: 'Interactive cards on hover; the primary CTA at rest.',
  },
  {
    name: 'xl',
    value: 'shadow-xl',
    description: 'The primary CTA on hover; the contact form panel.',
  },
  {
    name: 'primary/5',
    value: 'shadow-primary/5',
    description: 'A trace of brand in the contact panel’s shadow.',
  },
  {
    name: 'primary/10',
    value: 'shadow-primary/10',
    description: 'Interactive and selected cards.',
  },
  {
    name: 'primary/20',
    value: 'shadow-primary/20',
    description: 'The primary CTA at rest.',
  },
  {
    name: 'primary/30',
    value: 'shadow-primary/30',
    description: 'The primary CTA on hover; the sent confirmation badge.',
  },
  {
    name: 'highlight',
    value: 'var(--shadow-highlight)',
    description:
      'The highlighted pricing plan: brand hairline plus soft glow (`shadow-highlight`).',
  },
  {
    name: 'halo',
    value: 'var(--shadow-halo)',
    description:
      'The current contact step: a faint 6px brand halo (`shadow-halo`).',
  },
  {
    name: 'header hairline',
    value: 'shadow-foreground/[0.03]',
    description: 'Tints the header’s `shadow-sm` to a near-invisible line.',
  },
];

/* ------------------------------------------------------------------ */
/* Borders and rings                                                   */
/* ------------------------------------------------------------------ */

/** Borders: widths, sides and the tints they use. */
export const BORDERS: readonly TokenEntry[] = [
  {
    name: 'default',
    value: 'border',
    description: '1px in the border color; every element defaults to it.',
  },
  {
    name: 'band edges',
    value: 'border-y border-border/60',
    description: 'Top and bottom of a muted section band.',
  },
  {
    name: 'bar edge',
    value: 'border-b border-border/60',
    description: 'The scrolled header and the sticky contact bar (`border-t`).',
  },
  {
    name: 'panel',
    value: 'border-border/70',
    description: 'The contact form panel from `md`.',
  },
  {
    name: 'field',
    value: 'border-input',
    description: 'Form fields; `border-ring` once focused.',
  },
  {
    name: 'brand',
    value: 'border-primary/30',
    description: 'A card that belongs to the brand (about facts).',
  },
  {
    name: 'brand hover',
    value: 'hover:border-primary/40',
    description: 'FAQ items, option cards and footer links on hover.',
  },
  {
    name: 'invalid',
    value: 'aria-invalid:border-destructive',
    description: 'A field the visitor must fix.',
  },
];

/** Rings: outlines drawn with box-shadow, so they never shift layout. */
export const RINGS: readonly TokenEntry[] = [
  {
    name: 'focus',
    value: 'focus-visible:ring-3 focus-visible:ring-ring/50',
    description: 'The house keyboard focus ring (`FOCUS_RING`).',
  },
  {
    name: 'base outline',
    value: 'outline-ring/50',
    description: 'Every element’s outline color, set in the base layer.',
  },
  {
    name: 'card outline',
    value: 'ring-1 ring-foreground/10',
    description: 'A card’s faint edge on any surface (`CARD_OUTLINE`).',
  },
  {
    name: 'card hover',
    value: 'hover:ring-primary/40',
    description: 'An interactive card’s edge picking up the brand.',
  },
  {
    name: 'invalid',
    value: 'aria-invalid:ring-destructive/20',
    description: 'A soft red halo on an invalid field (/40 in dark).',
  },
];

/* ------------------------------------------------------------------ */
/* Effects                                                             */
/* ------------------------------------------------------------------ */

/** Blur levels: glows are soft, glass bars only lightly frosted. */
export const BLUR: readonly TokenEntry[] = [
  {
    name: '2xl',
    value: 'blur-2xl',
    description: 'The hero’s main glow.',
  },
  {
    name: '3xl',
    value: 'blur-3xl',
    description: 'Secondary glows (hero side glow, page glow).',
  },
  {
    name: 'backdrop sm',
    value: 'backdrop-blur-sm',
    description: 'The contact form panel from `md`.',
  },
  {
    name: 'backdrop md',
    value: 'backdrop-blur-md',
    description: 'The scrolled header and the sticky contact bar.',
  },
];

/** The radial brand glows behind page tops and under the pointer. */
export const GLOWS: readonly TokenEntry[] = [
  {
    name: 'hero',
    value:
      'bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--brand)_22%,transparent),transparent)]',
    description: 'Behind the hero headline, drifting in on load.',
  },
  {
    name: 'hero side',
    value:
      'bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--primary)_14%,transparent),transparent)]',
    description: 'The hero’s second, offset glow.',
  },
  {
    name: 'page',
    value:
      'bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--brand)_20%,transparent),transparent)]',
    description: 'Behind a page’s top (`PageGlow`); a 12% one sits low right.',
  },
  {
    name: 'spotlight',
    value:
      'bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--primary)_16%,transparent),transparent)]',
    description: 'Follows the pointer across a card (`CardSpotlight`).',
  },
];

/** Stacking layers, from behind the page to above everything. */
export const Z_INDEX: readonly TokenEntry[] = [
  {
    name: 'background',
    value: '-z-10',
    description: 'Glows, header backdrops and active-link pills.',
  },
  {
    name: 'raised',
    value: 'z-10',
    description: 'The sticky contact bar and stretched card links.',
  },
  {
    name: 'header',
    value: 'z-40',
    description: 'The sticky site header.',
  },
  {
    name: 'overlay',
    value: 'z-50',
    description: 'The scroll progress bar and the skip link.',
  },
];

/** The opacity modifiers in use, and what each tint is for. */
export const OPACITY: readonly TokenEntry[] = [
  { name: '5', value: '/5', description: 'A trace of brand in a shadow.' },
  { name: '10', value: '/10', description: 'Card outlines, soft shadows.' },
  { name: '20', value: '/20', description: 'CTA glow, invalid rings.' },
  { name: '30', value: '/30', description: 'Brand borders, CTA hover glow.' },
  { name: '40', value: '/40', description: 'Muted bands, brand hovers.' },
  { name: '50', value: '/50', description: 'Focus rings and outlines.' },
  { name: '60', value: '/60', description: 'Band and bar borders.' },
  { name: '70', value: '/70', description: 'Glass header bar, chips.' },
  { name: '80', value: '/80', description: 'The contact panel’s card fill.' },
  { name: '85', value: '/85', description: 'Header bar without blur.' },
  { name: '90', value: '/90', description: 'The sticky contact bar.' },
  {
    name: '0.03',
    value: '/[0.03]',
    description: 'The header’s hairline shadow tint.',
  },
];

/* ------------------------------------------------------------------ */
/* Typography                                                          */
/* ------------------------------------------------------------------ */

/** Font families: one variable family, self-hosted, for everything. */
export const FONT_FAMILIES: readonly TokenEntry[] = [
  {
    name: 'body',
    value: 'var(--font-body)',
    description: 'Geist Variable for running text.',
  },
  {
    name: 'heading',
    value: 'var(--font-heading)',
    description: 'Geist Variable for h1 to h3.',
  },
  {
    name: 'sans',
    value: 'var(--font-sans)',
    description: 'Tailwind’s `font-sans`, pointed at the body font.',
  },
];

/** The type sizes in use, smallest to largest. */
export const FONT_SIZES: readonly TokenEntry[] = [
  { name: 'xs', value: 'text-xs', description: 'Badges, fine print.' },
  { name: 'sm', value: 'text-sm', description: 'Eyebrows, nav, captions.' },
  { name: 'base', value: 'text-base', description: 'Body, buttons, fields.' },
  { name: 'lg', value: 'text-lg', description: 'Leads and card titles.' },
  { name: 'xl', value: 'text-xl', description: 'Leads from `sm`/`md`.' },
  { name: '2xl', value: 'text-2xl', description: 'Sub-titles.' },
  { name: '3xl', value: 'text-3xl', description: 'Section titles.' },
  { name: '4xl', value: 'text-4xl', description: 'Page and hero titles.' },
  { name: '5xl', value: 'text-5xl', description: 'Page titles from `sm`.' },
  { name: '6xl', value: 'text-6xl', description: 'The hero from `sm`.' },
  { name: '7xl', value: 'text-7xl', description: 'The hero from `lg`.' },
];

/** Font weights in use. */
export const FONT_WEIGHTS: readonly TokenEntry[] = [
  {
    name: 'medium',
    value: 'font-medium',
    description: 'Buttons, nav links, labels.',
  },
  {
    name: 'semibold',
    value: 'font-semibold',
    description: 'Headings and eyebrows.',
  },
  {
    name: 'bold',
    value: 'font-bold',
    description: 'The hero and page titles.',
  },
];

/** Letter spacing and line height adjustments in use. */
export const TRACKING: readonly TokenEntry[] = [
  {
    name: 'tight',
    value: 'tracking-tight',
    description: 'Every heading.',
  },
  {
    name: 'wide',
    value: 'tracking-wide',
    description: 'Eyebrows, so small caps-like labels breathe.',
  },
  {
    name: 'display leading',
    value: 'leading-[1.05]',
    description: 'The hero headline’s tight line height.',
  },
];

/** The typography recipes, each pointing at its `TYPE` class set. */
export const TYPE_RECIPES: readonly (TokenEntry & {
  recipe: keyof typeof TYPE;
})[] = [
  {
    name: 'Display',
    recipe: 'display',
    value: TYPE.display,
    description: 'The home hero’s headline.',
  },
  {
    name: 'Page title',
    recipe: 'pageTitle',
    value: TYPE.pageTitle,
    description: 'A standalone page’s h1.',
  },
  {
    name: 'Section title',
    recipe: 'sectionTitle',
    value: TYPE.sectionTitle,
    description: 'A landing section’s heading.',
  },
  {
    name: 'Sub-title',
    recipe: 'subTitle',
    value: TYPE.subTitle,
    description: 'A heading inside a section.',
  },
  {
    name: 'Step title',
    recipe: 'stepTitle',
    value: TYPE.stepTitle,
    description: 'A contact step’s heading.',
  },
  {
    name: 'Card title',
    recipe: 'cardTitle',
    value: TYPE.cardTitle,
    description: 'A card’s heading.',
  },
  {
    name: 'Eyebrow',
    recipe: 'eyebrow',
    value: TYPE.eyebrow,
    description: 'The label above a heading.',
  },
  {
    name: 'Lead',
    recipe: 'lead',
    value: TYPE.lead,
    description: 'The paragraph under a heading.',
  },
  {
    name: 'Small',
    recipe: 'small',
    value: TYPE.small,
    description: 'Secondary small text.',
  },
];

/* ------------------------------------------------------------------ */
/* Motion                                                              */
/* ------------------------------------------------------------------ */

export {
  DURATION,
  EASE_OUT,
  REVEAL_DISTANCE,
  REVEAL_VIEWPORT,
  SLIDE_IN_DISTANCE,
  SLIDE_IN_OFFSET,
  SLIDE_IN_OPACITY,
  STAGGER,
  WORD_STAGGER,
} from './motion/tokens';

/**
 * Easings for CSS transitions. Known inconsistency: some transitions use
 * Tailwind's `ease-out`, others the site's `--ease-site`; unifying them is a
 * visible change, so both stay for now.
 */
export const CSS_EASINGS: readonly TokenEntry[] = [
  {
    name: 'site',
    value: 'var(--ease-site)',
    description:
      'ease-out-quint, the same curve as `EASE_OUT`: header, nav underline, card spotlight, FAQ, view transitions (`ease-(--ease-site)`).',
  },
  {
    name: 'ease-out',
    value: 'ease-out',
    description:
      'Tailwind’s ease-out: CTAs, interactive cards, arrows, FAQ icon and border (known inconsistency with `site`).',
  },
];

/** Durations for CSS transitions. */
export const CSS_DURATIONS: readonly TokenEntry[] = [
  {
    name: '200ms',
    value: 'duration-200',
    description: 'Small feedback: CTA lift, arrow nudge, option cards.',
  },
  {
    name: '300ms',
    value: 'duration-300',
    description: 'Cards, FAQ items, header bar and nav underline.',
  },
  {
    name: '500ms',
    value: 'duration-500',
    description: 'The card spotlight fading in.',
  },
];

/** CSS keyframe animations. */
export const KEYFRAMES: readonly TokenEntry[] = [
  {
    name: 'hero-glow',
    value: 'var(--animate-hero-glow)',
    description:
      '2.4s, ease-out-quint: the hero glow drifts down and grows into place on load (`animate-hero-glow`).',
  },
  {
    name: 'page-out',
    value: 'page-out',
    description: 'The old page fading and sliding away in a view transition.',
  },
  {
    name: 'page-in',
    value: 'page-in',
    description: 'The new page fading and sliding in in a view transition.',
  },
];

/** Page view transition timings, as the `page-in`/`page-out` CSS sets them. */
export const VIEW_TRANSITIONS: readonly TokenEntry[] = [
  {
    name: 'crossfade',
    value: '0.3s',
    description: 'The default crossfade between pages.',
  },
  {
    name: 'out',
    value: '0.25s',
    description: 'The old page leaving (`page-out`) with a direction.',
  },
  {
    name: 'in',
    value: '0.4s',
    description: 'The new page arriving (`page-in`) with a direction.',
  },
  {
    name: 'shift',
    value: 'var(--page-shift)',
    description: '2rem forward, -2rem back: how far a page slides.',
  },
];

/** The spring transitions motion components use. */
export const SPRINGS: readonly SpringToken[] = [
  {
    name: 'scroll progress',
    value: 'stiffness 200, damping 40',
    source: 'motion/scroll-progress.tsx',
    description: 'Smooths the reading progress bar.',
  },
  {
    name: 'slide in',
    value: 'stiffness 200, damping 40',
    source: 'motion/slide-in.tsx',
    description: 'Smooths paired cards sliding in while scrolling.',
  },
  {
    name: 'active indicator',
    value: 'bounce 0.15, duration DURATION.fast (0.4s)',
    source: 'motion/active-indicator.tsx',
    description: 'The pill gliding to the active nav link.',
  },
  {
    name: 'process line',
    value: 'stiffness 160, damping 30',
    source: 'app',
    description: 'A timeline line filling as you scroll.',
  },
  {
    name: 'step progress',
    value: 'stiffness 160, damping 26',
    source: 'app',
    description: 'A multi-step form’s progress bar between steps.',
  },
  {
    name: 'option check',
    value: 'stiffness 600, damping 25',
    source: 'app',
    description: 'A selected option’s check popping in.',
  },
  {
    name: 'sent badge',
    value: 'stiffness 380, damping 18',
    source: 'app',
    description: 'A confirmation badge bouncing in after a form is sent.',
  },
];
