import { motion, useReducedMotion, type HTMLMotionProps } from 'motion/react';

import {
  REVEAL_VIEWPORT,
  revealVariants,
  staggerVariants,
  type RevealDirection,
} from './tokens';

/** The elements a reveal can render as. */
const ELEMENTS = {
  div: motion.div,
  section: motion.section,
  header: motion.header,
  aside: motion.aside,
  h1: motion.h1,
  h2: motion.h2,
  p: motion.p,
  ul: motion.ul,
  ol: motion.ol,
  li: motion.li,
} as const;

type RevealElement = keyof typeof ELEMENTS;

type MotionOwnedProps =
  'initial' | 'animate' | 'whileInView' | 'variants' | 'viewport';

type RevealBaseProps = Omit<HTMLMotionProps<'div'>, MotionOwnedProps> & {
  /** The element to render; a `div` by default. */
  as?: RevealElement;
  /**
   * `view` (the default) waits until the element scrolls into view;
   * `mount` plays at once, for content that opens the page.
   */
  trigger?: 'view' | 'mount';
};

/** The motion props that start a reveal on view or on mount. */
function triggerProps(trigger: 'view' | 'mount', reduceMotion: boolean) {
  return {
    // With reduced motion there is no hidden state: the content renders in
    // its final place, and nothing ever waits on an animation to show it.
    initial: reduceMotion ? false : ('hidden' as const),
    ...(trigger === 'mount'
      ? { animate: 'visible' as const }
      : { whileInView: 'visible' as const, viewport: REVEAL_VIEWPORT }),
  };
}

type RevealProps = RevealBaseProps & {
  /** Where the content comes from; `up` (rising into place) by default. */
  direction?: RevealDirection;
  /** Seconds to wait before it starts. */
  delay?: number;
};

/**
 * Fades its content in with a short slide as it enters the viewport, once.
 * Under reduced motion it renders the content in place, visible.
 */
export function Reveal({
  as = 'div',
  trigger = 'view',
  direction = 'up',
  delay = 0,
  ...props
}: RevealProps) {
  const reduceMotion = useReducedMotion() ?? false;
  const Element = ELEMENTS[as] as typeof motion.div;

  return (
    <Element
      {...triggerProps(trigger, reduceMotion)}
      variants={revealVariants(direction, delay)}
      {...props}
    />
  );
}

type RevealGroupProps = RevealBaseProps & {
  /** Seconds between two items' reveals. */
  stagger?: number;
  /** Seconds before the first item starts. */
  delay?: number;
};

/**
 * Reveals its `RevealItem`s one after another as the group enters the
 * viewport (or on mount). The group itself does not move.
 */
export function RevealGroup({
  as = 'div',
  trigger = 'view',
  stagger,
  delay,
  ...props
}: RevealGroupProps) {
  const reduceMotion = useReducedMotion() ?? false;
  const Element = ELEMENTS[as] as typeof motion.div;

  return (
    <Element
      {...triggerProps(trigger, reduceMotion)}
      variants={staggerVariants(stagger, delay)}
      {...props}
    />
  );
}

type RevealItemProps = Omit<HTMLMotionProps<'div'>, MotionOwnedProps> & {
  /** The element to render; a `div` by default. */
  as?: RevealElement;
  /** Where the item comes from; `up` by default. */
  direction?: RevealDirection;
};

/** One item of a `RevealGroup`; its group decides when it plays. */
export function RevealItem({
  as = 'div',
  direction = 'up',
  ...props
}: RevealItemProps) {
  const Element = ELEMENTS[as] as typeof motion.div;
  return <Element variants={revealVariants(direction)} {...props} />;
}
