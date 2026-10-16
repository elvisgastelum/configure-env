import type { SchemaDocument } from '@configure-env/core/schema';
import { Badge } from '@configure-env/design-system/components/atoms/badge';
import { Button } from '@configure-env/design-system/components/atoms/button';
import { cn } from '@configure-env/design-system/utils';
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  Lock,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { moveItem, useDragReorder } from './reorder';

/**
 * The schema's variables in declaration order, the order files that take
 * `"*"` write them in. Drag a row, or use its arrows, to reorder; the new
 * order is saved through a review like any other edit.
 */
export function VariableList({
  document,
  onAdd,
  onEdit,
  onRemove,
  onReorder,
}: {
  document: SchemaDocument;
  /** Absent until an editor is wired in: no add button. */
  onAdd?: () => void;
  onEdit?: (name: string) => void;
  onRemove: (name: string) => void;
  onReorder: (order: string[]) => void;
}) {
  const { t } = useTranslation();
  const declared = Object.keys(document.variables);
  const [order, setOrder] = useState(declared);
  const [lastDeclared, setLastDeclared] = useState(declared.join('\n'));
  // A schema that changed (saved, or edited elsewhere) resets the order.
  if (declared.join('\n') !== lastDeclared) {
    setLastDeclared(declared.join('\n'));
    setOrder(declared);
  }
  const shown = order.filter((name) => document.variables[name]);
  const changed = shown.join('\n') !== declared.join('\n');
  const move = (from: number, to: number) =>
    setOrder((current) => moveItem(current, from, to));
  const { itemProps } = useDragReorder(move);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {t('schemaEditor.variables.count', { count: shown.length })}
        </p>
        {onAdd && (
          <Button size="sm" onClick={onAdd}>
            <Plus aria-hidden="true" data-icon="inline-start" />
            {t('schemaEditor.variables.add')}
          </Button>
        )}
      </div>
      {changed && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-primary/10 px-3 py-2 text-sm"
        >
          <span>{t('schemaEditor.variables.orderChanged')}</span>
          <span className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setOrder(declared)}
            >
              {t('schemaEditor.variables.resetOrder')}
            </Button>
            <Button size="sm" onClick={() => onReorder(shown)}>
              {t('schemaEditor.variables.reviewOrder')}
            </Button>
          </span>
        </div>
      )}
      {shown.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          {t('schemaEditor.variables.empty')}
        </p>
      ) : (
        <ol
          aria-label={t('schemaEditor.variables.label')}
          className="flex flex-col divide-y rounded-lg border"
        >
          {shown.map((name, index) => {
            const spec = document.variables[name]!;
            return (
              <li
                key={name}
                data-variable={name}
                {...itemProps(index)}
                className={cn(
                  'flex flex-wrap items-center gap-2 px-2 py-2 data-dragging:opacity-50',
                )}
              >
                <GripVertical
                  aria-label={t('schemaEditor.variables.drag', { name })}
                  className="size-4 shrink-0 cursor-grab text-muted-foreground"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-sm font-medium break-all">
                      {name}
                    </span>
                    <Badge variant="outline" className="font-mono">
                      {spec.type}
                    </Badge>
                    {spec.group && (
                      <Badge variant="secondary">{spec.group}</Badge>
                    )}
                    {spec.required && (
                      <Badge variant="outline">
                        {t('schemaEditor.variables.required')}
                      </Badge>
                    )}
                    {spec.secret && (
                      <Badge variant="outline">
                        {t('schemaEditor.variables.secret')}
                      </Badge>
                    )}
                    {spec.protected && (
                      <Badge variant="outline">
                        <Lock aria-hidden="true" />
                        {t('schemaEditor.variables.protected')}
                      </Badge>
                    )}
                  </span>
                  {spec.description && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {spec.description}
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-0.5">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t('schemaEditor.variables.moveUp', { name })}
                    disabled={index === 0}
                    onClick={() => move(index, index - 1)}
                  >
                    <ArrowUp aria-hidden="true" />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t('schemaEditor.variables.moveDown', { name })}
                    disabled={index === shown.length - 1}
                    onClick={() => move(index, index + 1)}
                  >
                    <ArrowDown aria-hidden="true" />
                  </Button>
                  {onEdit && (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t('schemaEditor.variables.edit', { name })}
                      onClick={() => onEdit(name)}
                    >
                      <Pencil aria-hidden="true" />
                    </Button>
                  )}
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t('schemaEditor.variables.remove', { name })}
                    onClick={() => onRemove(name)}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
