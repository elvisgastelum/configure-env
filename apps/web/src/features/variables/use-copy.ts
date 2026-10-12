import { toast } from '@configure-env/design-system/components/atoms/sonner';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { NothingToCopy, writeClipboard } from './copy';

/** What to copy, and the toast that says it was. */
interface Copied {
  text: string;
  message: string;
}

/**
 * Copies what `prepare` resolves to, then says so in a toast; a failure (no
 * value, a refused reveal, no clipboard) says why instead. Resolves whether
 * it copied.
 */
export function useCopy() {
  const { t } = useTranslation();
  return useCallback(
    async (prepare: () => Promise<Copied>) => {
      try {
        const { text, message } = await prepare();
        await writeClipboard(text);
        toast.success(message);
        return true;
      } catch (error) {
        toast.error(
          error instanceof NothingToCopy
            ? t('variables.copy.notSet', {
                name: error.key,
                file: error.file,
              })
            : t('variables.copy.failed', {
                message: (error as Error).message,
              }),
        );
        return false;
      }
    },
    [t],
  );
}
