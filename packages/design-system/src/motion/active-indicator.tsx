import { motion } from 'motion/react';

import { DURATION } from './tokens';
import { cn } from '../lib/utils';

/**
 * The pill behind the active item of a set (a nav link, a pressed toggle).
 * Every item of the set renders it with the same `layoutId` while it is
 * active, so moving the selection slides the pill from the old item to the
 * new one (a layout transform). Its parent must be `relative` and `isolate`.
 * Decorative; under reduced motion it moves at once.
 */
export function ActiveIndicator({
  layoutId,
  testId,
  className,
}: {
  layoutId: string;
  testId: string;
  className?: string;
}) {
  return (
    <motion.span
      layoutId={layoutId}
      aria-hidden="true"
      data-testid={testId}
      className={cn(
        'pointer-events-none absolute inset-0 -z-10 rounded-full',
        className,
      )}
      transition={{ type: 'spring', bounce: 0.15, duration: DURATION.fast }}
    />
  );
}
