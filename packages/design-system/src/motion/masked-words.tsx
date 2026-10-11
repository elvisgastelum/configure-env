import { motion, type Variants } from 'motion/react';
import { Fragment } from 'react';

import { DURATION, EASE_OUT } from './tokens';

/** A word rises out of its mask: a transform only, never its opacity. */
const wordVariants: Variants = {
  hidden: { y: '110%' },
  visible: { y: 0, transition: { duration: DURATION.slow, ease: EASE_OUT } },
};

/**
 * Text whose words rise one by one out of a clipping mask, played by the
 * nearest motion parent's `hidden` → `visible` (such as a reveal group, or
 * a `motion` heading with `staggerVariants(WORD_STAGGER)`). The words keep their
 * spaces as plain text, so the text wraps and reads as it would unsplit.
 * Under reduced motion the reveal starts visible, and the words sit in place.
 */
export function MaskedWords({ text }: { text: string }) {
  const words = text.split(/\s+/).filter(Boolean);

  return words.map((word, index) => (
    <Fragment key={index}>
      {index > 0 && ' '}
      {/* The padding gives descenders room inside the mask. */}
      <span className="inline-block overflow-hidden pb-[0.12em] -mb-[0.12em] align-bottom">
        <motion.span
          data-testid="masked-word"
          className="inline-block will-change-transform"
          variants={wordVariants}
        >
          {word}
        </motion.span>
      </span>
    </Fragment>
  ));
}
