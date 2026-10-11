import type { Transition, Variants } from 'motion/react';

/** The site's easing: a quick start that settles softly (ease-out-quint). */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

/** Durations in seconds, short enough never to hold the reader back. */
export const DURATION = {
  fast: 0.4,
  base: 0.6,
  slow: 0.8,
} as const;

/** The pause between two items of a staggered group, in seconds. */
export const STAGGER = 0.08;

/** The pause between two words of a masked headline, in seconds. */
export const WORD_STAGGER = 0.045;

/** How far, in px, a revealed element travels on its way in. */
export const REVEAL_DISTANCE = 24;

/** Where a revealed element comes from. */
export type RevealDirection = 'up' | 'down' | 'left' | 'right' | 'none';

const OFFSETS: Record<RevealDirection, { x: number; y: number }> = {
  up: { x: 0, y: REVEAL_DISTANCE },
  down: { x: 0, y: -REVEAL_DISTANCE },
  left: { x: REVEAL_DISTANCE, y: 0 },
  right: { x: -REVEAL_DISTANCE, y: 0 },
  none: { x: 0, y: 0 },
};

/** The default transition of a reveal, after an optional delay. */
export function revealTransition(delay = 0): Transition {
  return { duration: DURATION.base, ease: EASE_OUT, delay };
}

/**
 * A reveal's two states: `hidden` (transparent and offset towards
 * `direction`) and `visible` (in place). Only opacity and transform change.
 */
export function revealVariants(
  direction: RevealDirection = 'up',
  delay = 0,
): Variants {
  return {
    hidden: { opacity: 0, ...OFFSETS[direction] },
    visible: { opacity: 1, x: 0, y: 0, transition: revealTransition(delay) },
  };
}

/** A staggered group's states: it only orders its items' reveals. */
export function staggerVariants(stagger = STAGGER, delay = 0): Variants {
  return {
    hidden: {},
    visible: {
      transition: { staggerChildren: stagger, delayChildren: delay },
    },
  };
}

/**
 * When an element reveals: as soon as any part of it is a little above the
 * bottom edge, so a tall block on a short screen (which may never be a set
 * share on screen) still reveals. Each one reveals once and stays.
 */
export const REVEAL_VIEWPORT = {
  once: true,
  amount: 'some',
  margin: '0px 0px -10% 0px',
} as const;

/** How far, in px, a paired card starts out towards its own side. */
export const SLIDE_IN_DISTANCE = 56;

/** How faint a paired card starts, before it slides into place. */
export const SLIDE_IN_OPACITY = 0.3;

/**
 * The scroll range of a slide-in, against the card: it starts as the card's
 * top enters at the bottom edge and ends when that top is 60% down the
 * viewport, well before the card is centred, so a card mostly in view
 * always looks final.
 */
export const SLIDE_IN_OFFSET = ['start end', 'start 60%'] as const;
