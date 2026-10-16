import type { Variable } from '@configure-env/api-client';
import { Button } from '@configure-env/design-system/components/atoms/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@configure-env/design-system/components/atoms/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@configure-env/design-system/components/atoms/dropdown-menu';
import { toast } from '@configure-env/design-system/components/atoms/sonner';
import { Eraser, MoreHorizontal, Sparkles } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { undoToast } from '../history/undo-toast';
import { isProtected, protectedReason } from './model';
import { type ValueEdit, useValueEdit } from './use-value-edits';

type Action = 'generate' | 'unset';

/**
 * The rarer actions on one value: generate a new random one (a secret
 * string only) and unset it. Unsetting asks first, and so does anything that
 * replaces a protected value; the protected value is then replaced on
 * purpose.
 */
export function ValueActions({
  variable,
  file,
}: {
  variable: Variable;
  file: string;
}) {
  const { t } = useTranslation();
  const edit = useValueEdit();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState<Action>();
  const { name, spec } = variable;
  const isSet = variable.files.some(
    (entry) => entry.file === file && entry.value !== undefined,
  );
  const locked = isProtected(spec) && isSet;
  const canGenerate = spec.type === 'string' && spec.secret;

  const run = (action: Action) => {
    setConfirming(undefined);
    const request: ValueEdit = { kind: action, file, key: name };
    edit.mutate(
      { ...request, ...(locked ? { replaceProtected: true } : {}) },
      {
        onSuccess: (written) =>
          toast.success(
            t(`variables.actions.${action}.done`, { name, file }),
            undoToast(queryClient, t, written.changes),
          ),
        onError: (error) =>
          toast.error(
            t(`variables.actions.${action}.failed`, {
              name,
              message: error.message,
            }),
          ),
      },
    );
  };
  const ask = (action: Action) => {
    if (action === 'unset' || locked) setConfirming(action);
    else run(action);
  };

  if (!canGenerate && !isSet) return null;
  const label = t('variables.actions.more', { name, file });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={label}
              title={label}
              disabled={edit.isPending}
            />
          }
        >
          <MoreHorizontal aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {canGenerate && (
            <DropdownMenuItem onClick={() => ask('generate')}>
              <Sparkles aria-hidden="true" />
              {t('variables.actions.generate.item')}
            </DropdownMenuItem>
          )}
          {isSet && (
            <DropdownMenuItem
              variant="destructive"
              onClick={() => ask('unset')}
            >
              <Eraser aria-hidden="true" />
              {t('variables.actions.unset.item')}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={confirming !== undefined}
        onOpenChange={(open) => {
          if (!open) setConfirming(undefined);
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="sm:max-w-md"
          onClick={(event) => event.stopPropagation()}
        >
          {confirming && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {t(`variables.actions.${confirming}.confirmTitle`, {
                    name,
                    file,
                  })}
                </DialogTitle>
                <DialogDescription>
                  {t(`variables.actions.${confirming}.confirmBody`, {
                    name,
                    file,
                  })}
                </DialogDescription>
              </DialogHeader>
              {locked && (
                <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                  {t('variables.actions.protected', { name })}{' '}
                  {protectedReason(spec)}
                </p>
              )}
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setConfirming(undefined)}
                >
                  {t('variables.edit.cancel')}
                </Button>
                <Button
                  variant={confirming === 'unset' ? 'destructive' : 'default'}
                  onClick={() => run(confirming)}
                >
                  {t(`variables.actions.${confirming}.confirm`)}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
