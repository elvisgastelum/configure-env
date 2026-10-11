import { MotionConfig } from 'motion/react';
import type { ReactNode } from 'react';

import { DURATION, EASE_OUT } from './tokens';

/**
 * The site's motion defaults: its easing and duration, and every animation
 * following the visitor's reduced-motion setting (transforms switch off).
 */
export function SiteMotionConfig({ children }: { children: ReactNode }) {
  return (
    <MotionConfig
      reducedMotion="user"
      transition={{ duration: DURATION.base, ease: EASE_OUT }}
    >
      {children}
    </MotionConfig>
  );
}
