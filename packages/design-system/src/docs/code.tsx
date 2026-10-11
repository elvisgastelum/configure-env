import { Check, Copy } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { FOCUS_RING } from '../recipes';
import { cn } from '../lib/utils';

/** A token value or class string in monospace. */
export function Code({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <code
      className={cn(
        'rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs break-words text-foreground',
        className,
      )}
    >
      {children}
    </code>
  );
}

/** Plain text whose `backticked` spans render as inline code. */
export function RichText({ children }: { children: string }) {
  return children
    .split('`')
    .map((part, index) =>
      index % 2 === 1 ? <Code key={index}>{part}</Code> : part,
    );
}

/** A class string or import path with a button that copies it. */
export function CopyCode({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
    } catch {
      // Clipboard access can be denied (insecure origin, permissions); the
      // text stays selectable.
    }
  };

  return (
    <span className="inline-flex max-w-full items-start gap-1.5">
      <Code className="min-w-0 select-all">{children}</Code>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? 'Copied' : `Copy ${children}`}
        className={cn(
          'grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground',
          FOCUS_RING,
        )}
      >
        {copied ? (
          <Check aria-hidden="true" className="size-3.5" />
        ) : (
          <Copy aria-hidden="true" className="size-3.5" />
        )}
      </button>
    </span>
  );
}

/** A highlighted note inside a docs page. */
export function Callout({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <aside className="sb-unstyled my-6 rounded-xl border border-primary/30 bg-accent/40 p-4 text-sm leading-relaxed text-foreground">
      {title && <p className="mb-1 font-semibold">{title}</p>}
      <div className="[&_code]:rounded-md! [&_code]:border-0! [&_code]:bg-muted! [&_code]:px-1.5! [&_code]:py-0.5! [&_code]:font-mono [&_code]:text-xs! [&_code]:text-foreground! [&_p+p]:mt-2">
        {children}
      </div>
    </aside>
  );
}
