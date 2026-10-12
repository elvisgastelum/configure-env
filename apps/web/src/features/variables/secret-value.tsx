import type { Variable } from '@configure-env/api-client';
import { Button } from '@configure-env/design-system/components/atoms/button';
import { Spinner } from '@configure-env/design-system/components/atoms/spinner';
import { Eye, EyeOff } from 'lucide-react';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  REVEAL_TIMEOUT_MS,
  RevealContext,
  type RevealState,
  type Revealed,
  fetchPlainValue,
  isMasked,
  useReveal,
} from './secrets';
import { PlainValue } from './variables-table';

/**
 * Holds the one revealed value of the page: a new reveal masks the last one,
 * and every reveal is masked again after `timeout` ms or on unmount.
 */
export function RevealProvider({
  timeout = REVEAL_TIMEOUT_MS,
  children,
}: {
  timeout?: number;
  children: ReactNode;
}) {
  const [revealed, setRevealed] = useState<Revealed>();
  const [pending, setPending] = useState<RevealState['pending']>();
  const [error, setError] = useState<RevealState['error']>();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const request = useRef(0);

  const hide = useCallback(() => {
    clearTimeout(timer.current);
    request.current += 1;
    setRevealed(undefined);
    setPending(undefined);
  }, []);

  const reveal = useCallback(
    (file: string, key: string) => {
      hide();
      setError(undefined);
      setPending({ file, key });
      const id = request.current;
      fetchPlainValue(file, key).then(
        (value) => {
          if (request.current !== id) return;
          setPending(undefined);
          setRevealed({ file, key, value });
          timer.current = setTimeout(hide, timeout);
        },
        (failure: unknown) => {
          if (request.current !== id) return;
          setPending(undefined);
          setError({ file, key, message: (failure as Error).message });
        },
      );
    },
    [hide, timeout],
  );

  useEffect(() => () => clearTimeout(timer.current), []);

  const state = useMemo(
    () => ({ revealed, pending, error, reveal, hide }),
    [revealed, pending, error, reveal, hide],
  );
  return (
    <RevealContext.Provider value={state}>{children}</RevealContext.Provider>
  );
}

const same = (
  entry: { file: string; key: string } | undefined,
  file: string,
  key: string,
) => entry?.file === file && entry.key === key;

/**
 * A value as the table and the drawer show it: a secret masked, with a
 * button that reveals it through the API (and masks it again).
 */
export function SecretValue({
  variable,
  file,
}: {
  variable: Variable;
  file: string;
}) {
  const { t } = useTranslation();
  const { revealed, pending, error, reveal, hide } = useReveal();
  if (!isMasked(variable, file))
    return <PlainValue variable={variable} file={file} />;

  const { name } = variable;
  const shown = same(revealed, file, name) ? revealed : undefined;
  const loading = same(pending, file, name);
  const failed = same(error, file, name) ? error : undefined;
  const label = shown
    ? t('variables.secret.hide', { name, file })
    : t('variables.secret.reveal', { name, file });

  return (
    <span className="flex min-w-0 flex-col">
      <span className="flex min-w-0 items-center gap-1">
        {shown ? (
          <span
            data-revealed=""
            className="truncate font-mono text-sm text-amber-700 dark:text-amber-300"
          >
            {shown.value ?? t('variables.notSet')}
          </span>
        ) : (
          <PlainValue variable={variable} file={file} />
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          title={label}
          aria-pressed={shown !== undefined}
          disabled={loading}
          onClick={(event) => {
            event.stopPropagation();
            if (shown) hide();
            else reveal(file, name);
          }}
        >
          {loading ? (
            <Spinner />
          ) : shown ? (
            <EyeOff aria-hidden="true" />
          ) : (
            <Eye aria-hidden="true" />
          )}
        </Button>
      </span>
      {failed && (
        <span role="alert" className="text-xs text-destructive">
          {t('variables.secret.failed', { message: failed.message })}
        </span>
      )}
    </span>
  );
}
