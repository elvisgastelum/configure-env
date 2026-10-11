import type { ReactNode } from 'react';
import { useRef, useSyncExternalStore } from 'react';

import {
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from 'motion/react';

import { SLIDE_IN_DISTANCE, SLIDE_IN_OFFSET, SLIDE_IN_OPACITY } from './tokens';

/** Tailwind's `md`: where paired cards sit side by side. */
const TWO_COLUMNS = '(min-width: 768px)';

function subscribeToColumns(onChange: () => void) {
  if (typeof window.matchMedia !== 'function') return () => {};
  const query = window.matchMedia(TWO_COLUMNS);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function isTwoColumns() {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia(TWO_COLUMNS).matches
  );
}

/** Whether the viewport is wide enough for two columns (`md` up). */
function useTwoColumns(): boolean {
  return useSyncExternalStore(subscribeToColumns, isTwoColumns, () => false);
}

/** The final state: in place and opaque. */
const SETTLED = { x: 0, opacity: 1 } as const;

type SlideInProps = {
  /** The side the card comes from, towards the centre. */
  from: 'left' | 'right';
  className?: string;
  children: ReactNode;
};

/**
 * Slides a card of a side-by-side pair in from its own side towards the
 * centre, faint to opaque, following the scroll: it plays back when the
 * page scrolls up, and settles before the card is centred. Only from `md`
 * up; on one stacked column and under reduced motion the card stays in
 * place and opaque. Only transform and opacity change, through motion
 * values, so scrolling never re-renders React.
 */
export function SlideIn({ from, className, children }: SlideInProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion() ?? false;
  const twoColumns = useTwoColumns();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: [...SLIDE_IN_OFFSET],
  });
  const progress = useSpring(scrollYProgress, {
    stiffness: 200,
    damping: 40,
    restDelta: 0.001,
  });
  const x = useTransform(
    progress,
    [0, 1],
    [from === 'left' ? -SLIDE_IN_DISTANCE : SLIDE_IN_DISTANCE, 0],
  );
  const opacity = useTransform(progress, [0, 1], [SLIDE_IN_OPACITY, 1]);
  const active = twoColumns && !reduceMotion;

  return (
    <motion.div
      ref={ref}
      data-slide-from={from}
      className={className}
      // Static values, not none, once inactive: motion keeps the last
      // values it set, so a window narrowed past `md` must reset them.
      style={active ? { x, opacity } : SETTLED}
    >
      {children}
    </motion.div>
  );
}
