// The "Undo" action of the toast that follows an edit: it undoes the changes
// the edit recorded, by the ids its answer names.

import { toast } from '@configure-env/design-system/components/atoms/sonner';
import type { QueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { undoChanges, undoFailure } from './history-api';

/**
 * The toast options that offer to undo `ids`: none when the edit recorded
 * nothing (the history could not be written, or nothing changed).
 */
export function undoToast(
  queryClient: QueryClient,
  t: TFunction,
  ids: readonly number[] | undefined,
) {
  if (!ids?.length) return {};
  return {
    action: {
      label: t('history.undo.action'),
      onClick: () => {
        undoChanges(queryClient, ids).then(
          () => toast.success(t('history.undo.done')),
          (error: unknown) =>
            toast.error(
              t('history.undo.failed', { message: undoFailure(error) }),
            ),
        );
      },
    },
  };
}
