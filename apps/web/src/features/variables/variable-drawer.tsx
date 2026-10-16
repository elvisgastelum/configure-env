import type { FileInfo, Variable } from '@configure-env/api-client';
import { Badge } from '@configure-env/design-system/components/atoms/badge';
import { Button } from '@configure-env/design-system/components/atoms/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@configure-env/design-system/components/atoms/sheet';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@configure-env/design-system/components/atoms/tabs';
import { useQuery } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { type ReactNode, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { projectQuery } from '../../lib/api';
import { editorItem } from '../editor/editor';
import { OpenInEditorButton } from '../editor/open-in-editor';
import { VariableHistory } from '../history/variable-history';
import { isProtected, protectedReason } from './model';
import { optionsOf, rulesOf } from './spec';
import { ValueMatrix } from './value-matrix';

/** One term of the drawer's definition list, its value named by the term. */
function Term({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-3 py-1.5">
      <dt id={id} className="text-muted-foreground">
        {label}
      </dt>
      <dd aria-labelledby={id} className="min-w-0 break-words">
        {children}
      </dd>
    </div>
  );
}

const show = (value: string | number | boolean) => String(value);

/**
 * A variable in full: its description and comment, its type and options,
 * its rules (each name a link to that variable), its default and example,
 * and its value in every env file that lists it.
 */
export function VariableDrawer({
  variable,
  files,
  all,
  editing,
  onEditingChange,
  onNavigate,
  onClose,
}: {
  /** The variable to show; the drawer is closed without one. */
  variable?: Variable;
  files: readonly FileInfo[];
  /** Every declared variable: a rule's name links only to these. */
  all: readonly Variable[];
  /** The file whose value is being edited. */
  editing?: string;
  onEditingChange: (file?: string) => void;
  onNavigate: (name: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Sheet
      open={variable !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        side="right"
        closeLabel={t('variables.drawer.close')}
        className="w-full overflow-y-auto data-[side=right]:sm:max-w-xl"
      >
        {variable && (
          <DrawerBody
            variable={variable}
            files={files}
            all={all}
            editing={editing}
            onEditingChange={onEditingChange}
            onNavigate={onNavigate}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function DrawerBody({
  variable,
  files,
  all,
  editing,
  onEditingChange,
  onNavigate,
}: {
  variable: Variable;
  files: readonly FileInfo[];
  all: readonly Variable[];
  editing?: string;
  onEditingChange: (file?: string) => void;
  onNavigate: (name: string) => void;
}) {
  const { t } = useTranslation();
  const known = new Set(all.map((other) => other.name));
  const { name, spec } = variable;
  const rules = rulesOf(spec);
  const options = optionsOf(spec);
  const schemaPath = useQuery(projectQuery).data?.schemaPath;

  return (
    <>
      <SheetHeader className="gap-2 pr-12">
        <SheetTitle className="font-mono text-lg">{name}</SheetTitle>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="font-mono">
            {spec.type}
          </Badge>
          {spec.group && <Badge variant="secondary">{spec.group}</Badge>}
          {spec.required && (
            <Badge variant="secondary">{t('variables.flags.required')}</Badge>
          )}
          {spec.secret && (
            <Badge variant="secondary">{t('variables.flags.secret')}</Badge>
          )}
        </div>
        <SheetDescription>
          {spec.description ?? t('variables.drawer.noDescription')}
        </SheetDescription>
      </SheetHeader>

      <Tabs defaultValue="details" className="px-4 pb-6">
        <TabsList aria-label={t('history.drawer.tabs')}>
          <TabsTrigger value="details">
            {t('history.drawer.details')}
          </TabsTrigger>
          <TabsTrigger value="history">{t('history.drawer.tab')}</TabsTrigger>
        </TabsList>
        <TabsContent value="details" className="flex flex-col gap-6 pt-2">
          {isProtected(spec) && (
            <ProtectedNote reason={protectedReason(spec)} />
          )}
          <dl
            aria-label={t('variables.drawer.details')}
            className="divide-y text-sm"
          >
            {spec.comment && (
              <Term label={t('variables.drawer.comment')}>{spec.comment}</Term>
            )}
            {options.map(({ option, value }) => (
              <Term
                key={option}
                label={t(`variables.drawer.optionLabels.${option}`)}
              >
                {Array.isArray(value) ? (
                  <span className="flex flex-wrap gap-1">
                    {value.map((item) => (
                      <Badge key={item} variant="outline" className="font-mono">
                        {item}
                      </Badge>
                    ))}
                  </span>
                ) : typeof value === 'boolean' ? (
                  value ? (
                    t('variables.drawer.yes')
                  ) : (
                    t('variables.drawer.no')
                  )
                ) : (
                  <code className="font-mono">{show(value)}</code>
                )}
              </Term>
            ))}
            {rules.map(({ rule, names }) => (
              <Term key={rule} label={t(`variables.drawer.ruleLabels.${rule}`)}>
                <span className="flex flex-wrap gap-1">
                  {names.map((other) =>
                    known.has(other) ? (
                      <Button
                        key={other}
                        variant="link"
                        size="xs"
                        className="h-auto px-0 font-mono"
                        onClick={() => onNavigate(other)}
                      >
                        {other}
                      </Button>
                    ) : (
                      <code key={other} className="font-mono">
                        {other}
                      </code>
                    ),
                  )}
                </span>
              </Term>
            ))}
            {spec.default !== undefined && (
              <Term label={t('variables.drawer.default')}>
                <code className="font-mono">{show(spec.default)}</code>
              </Term>
            )}
            {spec.example !== undefined && (
              <Term label={t('variables.drawer.example')}>
                <code className="font-mono">{show(spec.example)}</code>
              </Term>
            )}
            {schemaPath && (
              <Term label={t('variables.drawer.definition')}>
                <span className="flex items-center gap-1" {...editorItem}>
                  <code className="font-mono">{schemaPath}</code>
                  <OpenInEditorButton
                    target={{ file: schemaPath, key: name }}
                    label={t('editor.definition', {
                      key: name,
                      file: schemaPath,
                    })}
                  />
                </span>
              </Term>
            )}
          </dl>

          <ValueMatrix
            variable={variable}
            files={files}
            all={all}
            editing={editing}
            onEditingChange={onEditingChange}
          />
        </TabsContent>
        <TabsContent value="history" className="pt-2">
          <VariableHistory name={name} />
        </TabsContent>
      </Tabs>
    </>
  );
}

/** Why a protected variable's value is kept, and how to change it. */
function ProtectedNote({ reason }: { reason?: string }) {
  const { t } = useTranslation();
  return (
    <div
      role="note"
      className="flex gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
    >
      <Lock
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400"
      />
      <div className="flex flex-col gap-1">
        <p className="font-medium">{t('variables.protected.title')}</p>
        {reason && <p>{reason}</p>}
        <p className="text-muted-foreground">
          {t('variables.protected.explain')}
        </p>
      </div>
    </div>
  );
}
