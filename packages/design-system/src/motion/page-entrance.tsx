import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';

import { DURATION, EASE_OUT } from './tokens';

/**
 * Fades a page's content in with a short rise when its route mounts. Each
 * page renders its own layout, so a new route plays it again; there is no
 * exit animation to hold the router back. It stays short and small, so the
 * page's own reveals (trail, eyebrow, title, intro) carry the entrance.
 * Off under reduced motion.
 */
export function PageEntrance({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      className={className}
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DURATION.fast, ease: EASE_OUT }}
    >
      {children}
    </motion.div>
  );
}
