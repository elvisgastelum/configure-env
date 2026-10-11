import { RotateCcw } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { FOCUS_RING } from '../recipes';
import { cn } from '../lib/utils';

/**
 * Plays an entrance animation again: the button remounts the children, so
 * reveals and entrances start over from their hidden state.
 */
export function Replay({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const [run, setRun] = useState(0);
  return (
    <div className={cn('flex w-full flex-col gap-4', className)}>
      <button
        type="button"
        onClick={() => setRun((count) => count + 1)}
        className={cn(
          'inline-flex items-center gap-1.5 self-end rounded-full border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground outline-none hover:border-primary/40',
          FOCUS_RING,
        )}
      >
        <RotateCcw aria-hidden="true" className="size-3.5" />
        Replay
      </button>
      <div key={run}>{children}</div>
    </div>
  );
}
