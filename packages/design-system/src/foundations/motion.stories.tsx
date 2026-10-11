import type { Meta, StoryObj } from '@storybook/react-vite';
import { ArrowRight } from 'lucide-react';
import { useState } from 'react';

import { ActiveIndicator } from '../motion/active-indicator';
import { CardSpotlight } from '../motion/card-spotlight';
import { MaskedWords } from '../motion/masked-words';
import { PageEntrance } from '../motion/page-entrance';
import { Reveal, RevealGroup, RevealItem } from '../motion/reveal';
import { ScrollProgress } from '../motion/scroll-progress';
import { SlideIn } from '../motion/slide-in';
import { useScrolled } from '../motion/use-scrolled';
import type { RevealDirection } from '../motion/tokens';
import { Replay } from '../docs';
import {
  CARD_OUTLINE,
  CTA_GLOW,
  FOCUS_RING,
  INTERACTIVE_CARD,
  TYPE,
  ctaClassName,
} from '../recipes';
import { cn } from '../lib/utils';

/*
 * Live demos of every motion primitive, embedded in the Motion docs page.
 * Each entrance has a Replay button; under reduced motion (the OS setting)
 * everything renders in its final state instead.
 */

const meta = {
  title: 'Design System/Motion',
  parameters: { layout: 'padded' },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

const SAMPLE_CARD = cn(
  'rounded-2xl bg-card p-5 text-card-foreground',
  CARD_OUTLINE,
);

const DIRECTIONS: readonly RevealDirection[] = [
  'up',
  'down',
  'left',
  'right',
  'none',
];

/** `Reveal` from each direction, as it plays when it scrolls into view. */
export const RevealDirections: Story = {
  name: 'Reveal: directions',
  render: () => (
    <Replay>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        {DIRECTIONS.map((direction) => (
          <Reveal key={direction} direction={direction} className={SAMPLE_CARD}>
            <p className={TYPE.cardTitle}>{direction}</p>
            <p className={TYPE.small}>direction=&quot;{direction}&quot;</p>
          </Reveal>
        ))}
      </div>
    </Replay>
  ),
};

/** A `RevealGroup` revealing its items one `STAGGER` apart. */
export const RevealGroupStagger: Story = {
  name: 'RevealGroup: stagger',
  render: () => (
    <Replay>
      <RevealGroup as="ul" className="grid gap-3 sm:grid-cols-3">
        {['Discover', 'Design', 'Build', 'Launch', 'Measure', 'Iterate'].map(
          (step) => (
            <RevealItem as="li" key={step} className={SAMPLE_CARD}>
              <p className={TYPE.cardTitle}>{step}</p>
            </RevealItem>
          ),
        )}
      </RevealGroup>
    </Replay>
  ),
};

/** A headline whose words rise out of a mask, driven by a reveal group. */
export const MaskedWordsHeadline: Story = {
  name: 'MaskedWords: headline',
  render: () => (
    <Replay>
      <RevealGroup trigger="mount" stagger={0.045}>
        <h2 className={TYPE.display}>
          <MaskedWords text="Websites that load fast and feel alive" />
        </h2>
      </RevealGroup>
    </Replay>
  ),
};

/** `PageEntrance`: the short fade and rise a page plays when it mounts. */
export const PageEntranceDemo: Story = {
  name: 'PageEntrance',
  render: () => (
    <Replay>
      <PageEntrance className={cn(SAMPLE_CARD, 'flex flex-col gap-2')}>
        <p className={TYPE.eyebrow}>Contact</p>
        <p className={TYPE.pageTitle}>A new page</p>
        <p className={TYPE.lead}>Fades in and rises 8px in 0.4s.</p>
      </PageEntrance>
    </Replay>
  ),
};

/**
 * A pair of cards sliding in from their sides as the page scrolls. Scroll
 * this story: it follows the window's scroll, from 768px wide up.
 */
export const SlideInPair: Story = {
  name: 'SlideIn: paired cards',
  parameters: {
    layout: 'fullscreen',
    // The cards start faint on purpose and turn opaque as they scroll in;
    // contrast is checked on every other story, where text sits at rest.
    a11y: {
      config: { rules: [{ id: 'color-contrast', enabled: false }] },
    },
  },
  render: () => (
    <div className="px-6">
      <p className={cn(TYPE.small, 'py-8 text-center')}>
        Scroll down. The cards slide in from their sides and play back when you
        scroll up (768px wide and up; in place on one column and under reduced
        motion).
      </p>
      <div className="h-[80vh]" />
      <div className="mx-auto grid max-w-4xl gap-6 md:grid-cols-2">
        <SlideIn from="left">
          <div className={cn(SAMPLE_CARD, 'h-48')}>
            <p className={TYPE.cardTitle}>From the left</p>
          </div>
        </SlideIn>
        <SlideIn from="right">
          <div className={cn(SAMPLE_CARD, 'h-48')}>
            <p className={TYPE.cardTitle}>From the right</p>
          </div>
        </SlideIn>
      </div>
      <div className="h-[80vh]" />
    </div>
  ),
};

/** The pointer-following glow on a card host with the required classes. */
export const CardSpotlightDemo: Story = {
  name: 'CardSpotlight',
  render: () => (
    <div
      className={cn(
        'group/card relative isolate flex h-56 w-full max-w-md flex-col justify-end overflow-hidden',
        SAMPLE_CARD,
      )}
    >
      <CardSpotlight />
      <p className={TYPE.cardTitle}>Move the pointer over this card</p>
      <p className={TYPE.small}>
        Mouse or trackpad only; off on touch screens and under reduced motion.
      </p>
    </div>
  ),
};

const SEGMENTS = ['Home', 'Services', 'About', 'Contact'] as const;

function SegmentedNav() {
  const [active, setActive] = useState<(typeof SEGMENTS)[number]>('Home');
  return (
    <nav aria-label="Demo" className="rounded-full border border-border p-1">
      <ul className="flex flex-wrap gap-1">
        {SEGMENTS.map((segment) => (
          <li key={segment}>
            <button
              type="button"
              aria-pressed={segment === active}
              onClick={() => setActive(segment)}
              className={cn(
                'relative isolate rounded-full px-3 py-2 text-sm font-medium text-muted-foreground outline-none transition-colors hover:text-foreground aria-pressed:text-foreground',
                FOCUS_RING,
              )}
            >
              {segment === active && (
                <ActiveIndicator
                  layoutId="docs-segment"
                  testId="docs-segment"
                  className="bg-muted"
                />
              )}
              {segment}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** The pill that glides to the active item (a shared layout animation). */
export const ActiveIndicatorNav: Story = {
  name: 'ActiveIndicator',
  render: () => <SegmentedNav />,
};

/** The reading progress bar along the top; scroll the story to fill it. */
export const ScrollProgressDemo: Story = {
  name: 'ScrollProgress',
  parameters: { layout: 'fullscreen' },
  render: () => (
    <div className="px-6 py-8">
      <ScrollProgress />
      <p className={cn(TYPE.small, 'text-center')}>
        Scroll: the bar at the very top of the window fills with the page.
      </p>
      <div className="h-[200vh]" />
    </div>
  ),
};

function ScrolledHeader() {
  const scrolled = useScrolled();
  return (
    <header
      data-scrolled={scrolled}
      className="sticky top-0 border-b border-transparent bg-background/80 px-6 py-4 backdrop-blur transition-[border-color,box-shadow] duration-300 data-[scrolled=true]:border-border data-[scrolled=true]:shadow-sm"
    >
      <p className={TYPE.small}>
        {scrolled ? 'Scrolled: the header shows its border' : 'At the top'}
      </p>
    </header>
  );
}

/** `useScrolled()`: a header that gains a border once the page scrolls. */
export const UseScrolledDemo: Story = {
  name: 'useScrolled',
  parameters: { layout: 'fullscreen' },
  render: () => (
    <div>
      <ScrolledHeader />
      <div className="h-[200vh]" />
    </div>
  ),
};

/** The hero glow drifting into place (`motion-safe:animate-hero-glow`). */
export const HeroGlow: Story = {
  name: 'Hero glow keyframe',
  render: () => (
    <Replay>
      <div className="relative isolate h-72 overflow-hidden rounded-2xl border border-border bg-background">
        <div className="pointer-events-none absolute inset-x-0 -top-10 -z-10 mx-auto h-72 max-w-xl">
          <div className="absolute inset-0 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--brand)_22%,transparent),transparent)] blur-2xl motion-safe:animate-hero-glow" />
          <div className="absolute top-16 right-0 h-48 w-1/2 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--primary)_14%,transparent),transparent)] blur-3xl motion-safe:animate-hero-glow motion-safe:[animation-delay:300ms]" />
        </div>
        <p className={cn(TYPE.subTitle, 'grid h-full place-items-center')}>
          2.4s on load
        </p>
      </div>
    </Replay>
  ),
};

/** Hover and press feedback: CTA lift and press, card lift, arrow nudge. */
export const HoverAndPress: Story = {
  name: 'Hover and press',
  render: () => (
    <div className="flex w-full flex-col items-start gap-8">
      <div className="flex flex-wrap gap-4">
        <a href="#cta" className={ctaClassName('default', CTA_GLOW)}>
          Get a quote
          <ArrowRight className="transition-transform duration-200 ease-out motion-safe:group-hover/button:translate-x-0.5" />
        </a>
        <a href="#cta" className={ctaClassName('outline')}>
          See the work
        </a>
      </div>
      <a
        href="#card"
        className={cn(
          'group block w-full max-w-sm',
          SAMPLE_CARD,
          INTERACTIVE_CARD,
        )}
      >
        <p className={TYPE.cardTitle}>Interactive card</p>
        <p className={cn(TYPE.small, 'mt-2 inline-flex items-center gap-1')}>
          Lifts, casts a brand shadow and tints its ring
          <ArrowRight
            aria-hidden="true"
            className="size-4 transition-transform duration-200 ease-out motion-safe:group-hover:translate-x-0.5"
          />
        </p>
      </a>
    </div>
  ),
};
