import type { Change } from '@configure-env/api-client';
import { motion, useReducedMotion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { HistoryEntry } from './history-entry';

/** How long each change waits after the one above it appears. */
const STAGGER_S = 0.04;
/** The stagger stops growing after this many changes. */
const STAGGER_MAX = 10;

/**
 * Changes as a timeline, newest first: each enters after the one above it,
 * all at once without motion.
 */
export function HistoryTimeline({
  changes,
  label,
}: {
  changes: readonly Change[];
  label?: string;
}) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  return (
    <ol
      aria-label={label ?? t('history.list')}
      className="relative flex flex-col gap-3 border-l border-border pl-4"
    >
      {changes.map((change, index) => (
        <motion.li
          key={change.id}
          initial={reduce ? false : { opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={
            reduce
              ? { duration: 0 }
              : { delay: Math.min(index, STAGGER_MAX) * STAGGER_S }
          }
          className="relative before:absolute before:top-5 before:-left-[1.3rem] before:size-2 before:rounded-full before:bg-border"
        >
          <HistoryEntry change={change} />
        </motion.li>
      ))}
    </ol>
  );
}
