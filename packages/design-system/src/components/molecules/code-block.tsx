import { CheckIcon, CopyIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '../atoms/button';
import { cn } from '../../lib/utils';

/** How long the button shows the copied state before it resets. */
const COPIED_RESET_MS = 2000;

type CodeBlockProps = {
  /** The code to show and copy, as plain text. */
  code: string;
  /** Shown in the header bar, e.g. a file name or "Terminal". */
  title?: string;
  /** Set as `data-language` on the `<pre>` for an app's highlighter. */
  language?: string;
  /** Accessible name of the copy button; pass translated copy. */
  copyLabel?: string;
  /** Its name, and the announcement, once the code is copied. */
  copiedLabel?: string;
  /** Called when the clipboard refuses the write. */
  onCopyError?: (error: unknown) => void;
  className?: string;
};

/**
 * A block of monospaced code with a copy button. Copying writes `code` to
 * the clipboard, swaps the icon for a check and announces `copiedLabel`
 * for screen readers, then resets after two seconds.
 */
function CodeBlock({
  code,
  title,
  language,
  copyLabel = 'Copy',
  copiedLabel = 'Copied',
  onCopyError,
  className,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
    } catch (error) {
      onCopyError?.(error);
      return;
    }
    setCopied(true);
    clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(false), COPIED_RESET_MS);
  }

  return (
    <figure
      data-slot="code-block"
      className={cn(
        'group/code-block relative overflow-hidden rounded-xl border border-border bg-muted/50 text-sm',
        className,
      )}
    >
      {title && (
        <figcaption className="flex h-9 items-center border-b border-border px-4 pr-12 font-mono text-xs text-muted-foreground">
          {title}
        </figcaption>
      )}
      <pre
        data-language={language}
        className="overflow-x-auto p-4 pr-12 font-mono leading-relaxed text-foreground"
      >
        <code>{code}</code>
      </pre>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={copied ? copiedLabel : copyLabel}
        onClick={copy}
        className="absolute top-1 right-1 text-muted-foreground hover:text-foreground"
      >
        {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
      </Button>
      <span role="status" className="sr-only">
        {copied ? copiedLabel : ''}
      </span>
    </figure>
  );
}

export { CodeBlock, type CodeBlockProps };
