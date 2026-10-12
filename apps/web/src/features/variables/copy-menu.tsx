import type { Variable } from '@configure-env/api-client';
import { Button } from '@configure-env/design-system/components/atoms/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@configure-env/design-system/components/atoms/dropdown-menu';
import { Check, Copy } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  COPY_FORMATS,
  type CopyFormat,
  dotenvText,
  variableText,
} from './copy';
import { useCopy } from './use-copy';

/** How long the copy icon shows its check mark. */
const COPIED_MS = 1_500;

/** A copy icon that turns into a check mark for a moment after a copy. */
function useCopied() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const flash = useCallback(() => {
    clearTimeout(timer.current);
    setCopied(true);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  }, []);
  return [copied, flash] as const;
}

function CopyIcon({ copied }: { copied: boolean }) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span
        key={copied ? 'copied' : 'copy'}
        className="inline-flex"
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.6, opacity: 0 }}
        transition={{ duration: 0.18 }}
      >
        {copied ? (
          <Check aria-hidden="true" className="text-emerald-600" />
        ) : (
          <Copy aria-hidden="true" />
        )}
      </motion.span>
    </AnimatePresence>
  );
}

/**
 * The copy menu of one value: the value, `KEY=VALUE` or `export KEY=VALUE`;
 * with `fileVariables`, the whole file as dotenv too.
 */
export function CopyMenu({
  variable,
  file,
  label,
  fileVariables,
}: {
  variable: Variable;
  file: string;
  /** The trigger's accessible name. */
  label: string;
  /** Every variable of `file`, in order, for "the whole file". */
  fileVariables?: readonly Variable[];
}) {
  const { t } = useTranslation();
  const copy = useCopy();
  const [copied, flash] = useCopied();
  const { name } = variable;

  const copyFormat = async (format: CopyFormat) => {
    const ok = await copy(async () => ({
      text: await variableText(variable, file, format),
      message: t(`variables.copy.copied.${format}`, { name }),
    }));
    if (ok) flash();
  };
  const copyFile = async (list: readonly Variable[]) => {
    const ok = await copy(async () => {
      const { text, count } = await dotenvText(list, file);
      return {
        text,
        message: t('variables.copy.copied.file', { count, file }),
      };
    });
    if (ok) flash();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={label}
            title={label}
            onClick={(event) => event.stopPropagation()}
          />
        }
      >
        <CopyIcon copied={copied} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuGroup>
          {COPY_FORMATS.map((format) => (
            <DropdownMenuItem
              key={format}
              className={format === 'value' ? undefined : 'font-mono'}
              onClick={() => void copyFormat(format)}
            >
              {t(`variables.copy.${format}`)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        {fileVariables && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void copyFile(fileVariables)}>
              {t('variables.copy.file')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Copies a group's (or a file's) values as dotenv, in one click. */
export function CopyDotenvButton({
  variables,
  file,
  label,
  done,
}: {
  variables: readonly Variable[];
  file: string;
  label: string;
  /** The toast's message after a copy of `count` values. */
  done: (count: number) => string;
}) {
  const copy = useCopy();
  const [copied, flash] = useCopied();
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      title={label}
      onClick={async () => {
        const ok = await copy(async () => {
          const { text, count } = await dotenvText(variables, file);
          return { text, message: done(count) };
        });
        if (ok) flash();
      }}
    >
      <CopyIcon copied={copied} />
    </Button>
  );
}
