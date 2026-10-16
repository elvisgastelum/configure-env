import { FOCUS_RING } from '@configure-env/design-system/recipes';
import type { DiffLine as PlanLine } from '@configure-env/api-client';
import { cn } from '@configure-env/design-system/utils';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { type DiffRow, foldRows } from '../schema/diff';
import { rowsOf } from './plan-model';

const STYLE: Record<DiffRow['kind'], string> = {
  same: '',
  removed: 'bg-destructive/10',
  added: 'bg-primary/10',
  changed: '',
};
const MARK: Record<DiffRow['kind'], string> = {
  same: ' ',
  removed: '-',
  added: '+',
  changed: ' ',
};

/**
 * A file's change as one column, the way `diff -u` shows it: removed lines
 * marked `-`, added ones `+`, long unchanged stretches folded. The API masks
 * secrets in the lines.
 */
export function UnifiedDiff({
  lines,
  label,
}: {
  lines: readonly PlanLine[];
  label: string;
}) {
  const { t } = useTranslation();
  const items = useMemo(() => foldRows(rowsOf(lines)), [lines]);
  return (
    // Focusable, so a keyboard can scroll a diff wider or taller than its box.
    <div
      tabIndex={0}
      className={cn(
        'max-h-80 overflow-auto rounded-lg border outline-none',
        FOCUS_RING,
      )}
    >
      <table aria-label={label} className="w-full font-mono text-xs">
        <tbody>
          {items.map((item, index) =>
            'skipped' in item ? (
              <tr key={`skip-${index}`}>
                <td
                  colSpan={4}
                  className="bg-muted/60 px-2 py-1 text-center text-muted-foreground"
                >
                  {t('apply.plan.unchangedLines', { count: item.skipped })}
                </td>
              </tr>
            ) : (
              <tr
                key={index}
                data-kind={item.kind}
                className={cn(STYLE[item.kind])}
              >
                <td className="w-8 px-2 text-right align-top text-muted-foreground tabular-nums select-none">
                  {item.left?.line}
                </td>
                <td className="w-8 border-r px-2 text-right align-top text-muted-foreground tabular-nums select-none">
                  {item.right?.line}
                </td>
                <td className="w-4 pl-2 align-top text-muted-foreground select-none">
                  <span aria-hidden="true">{MARK[item.kind]}</span>
                  {item.kind !== 'same' && (
                    <span className="sr-only">
                      {t(`apply.plan.line.${item.kind}`)}
                    </span>
                  )}
                </td>
                <td data-text="" className="px-2 align-top whitespace-pre">
                  {(item.right ?? item.left)?.text}
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}
