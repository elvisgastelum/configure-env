import { motion, useReducedMotion, useScroll, useSpring } from 'motion/react';

/**
 * A thin bar along the top of the viewport that fills as the page scrolls.
 * Decorative: hidden from assistive tech. It follows the scroll through
 * motion values, so scrolling never re-renders React. Under reduced motion
 * it tracks the scroll exactly, without the spring's easing.
 */
export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const smooth = useSpring(scrollYProgress, {
    stiffness: 200,
    damping: 40,
    restDelta: 0.001,
  });
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      aria-hidden="true"
      data-testid="scroll-progress"
      className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 origin-left bg-primary"
      style={{ scaleX: reduceMotion ? scrollYProgress : smooth }}
    />
  );
}
