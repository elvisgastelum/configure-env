import { motion, useMotionValue, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useSyncExternalStore } from 'react';

const FINE_POINTER = '(hover: hover) and (pointer: fine)';

function subscribeToPointer(onChange: () => void) {
  if (typeof window.matchMedia !== 'function') return () => {};
  const query = window.matchMedia(FINE_POINTER);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function hasFinePointer() {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia(FINE_POINTER).matches
  );
}

/** Whether the visitor points with a mouse or trackpad that can hover. */
function useFinePointer(): boolean {
  return useSyncExternalStore(subscribeToPointer, hasFinePointer, () => false);
}

/** The glow's diameter in px; it is centred on the pointer. */
const SIZE = 360;

/**
 * A soft brand glow that follows the pointer across its card while it is
 * hovered. Drop it as the first child of a card that is `relative`,
 * `isolate`, `overflow-hidden` and a `group/card`: it sits behind the
 * content. The pointer moves it through motion values (a transform), so
 * React never re-renders per frame. Decorative, and left out for touch
 * screens and under reduced motion.
 */
export function CardSpotlight() {
  const reduceMotion = useReducedMotion();
  const finePointer = useFinePointer();
  const enabled = finePointer && !reduceMotion;
  const ref = useRef<HTMLSpanElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  useEffect(() => {
    const card = ref.current?.parentElement;
    if (!enabled || !card) return;
    const follow = (event: PointerEvent) => {
      const rect = card.getBoundingClientRect();
      x.set(event.clientX - rect.left - SIZE / 2);
      y.set(event.clientY - rect.top - SIZE / 2);
    };
    card.addEventListener('pointermove', follow);
    return () => card.removeEventListener('pointermove', follow);
  }, [enabled, x, y]);

  if (!enabled) return null;

  return (
    <motion.span
      ref={ref}
      aria-hidden="true"
      data-testid="card-spotlight"
      className="pointer-events-none absolute top-0 left-0 -z-10 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--primary)_16%,transparent),transparent)] opacity-0 transition-opacity duration-500 ease-(--ease-site) group-hover/card:opacity-100"
      style={{ x, y, width: SIZE, height: SIZE }}
    />
  );
}
