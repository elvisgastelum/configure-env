import { cn } from '@configure-env/design-system/utils';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { type DiffLine, type DiffRow, diffLines, foldRows } from './diff';

const ROW_STYLE: Record<DiffRow['kind'], { left: string; right: string }> = {
  same: { left: '', right: '' },
  removed: { left: 'bg-destructive/10', right: 'bg-muted/40' },
  added: { left: 'bg-muted/40', right: 'bg-primary/10' },
  changed: { left: 'bg-destructive/10', right: 'bg-primary/10' },
};

const MARK: Record<DiffRow['kind'], { left: string; right: string }> = {
  same: { left: ' ', right: ' ' },
  removed: { left: '-', right: ' ' },
  added: { left: ' ', right: '+' },
  changed: { left: '-', right: '+' },
};

function Side({
  line,
  mark,
  className,
}: {
  line?: DiffLine;
  mark: string;
  className: string;
}) {
  return (
    <>
      <td
        className={cn(
          'w-10 border-r px-2 text-right align-top text-muted-foreground tabular-nums select-none',
          className,
        )}
      >
        {line?.line}
      </td>
      <td className={cn('px-2 align-top whitespace-pre', className)}>
        {line && (
          <>
            <span aria-hidden="true" className="text-muted-foreground">
              {mark}{' '}
            </span>
            {line.text}
          </>
        )}
      </td>
    </>
  );
}

/** Two texts side by side, the lines that differ marked and colored. */
export function DiffView({
  before,
  after,
  label,
}: {
  before: string;
  after: string;
  label: string;
}) {
  const { t } = useTranslation();
  const items = useMemo(
    () => foldRows(diffLines(before, after)),
    [before, after],
  );
  return (
    <div className="max-h-[60vh] overflow-auto rounded-lg border">
      <table aria-label={label} className="w-full font-mono text-xs">
        <thead className="sticky top-0 bg-background text-left text-muted-foreground">
          <tr>
            <th colSpan={2} className="border-b px-2 py-1.5 font-medium">
              {t('schemaEditor.review.before')}
            </th>
            <th
              colSpan={2}
              className="border-b border-l px-2 py-1.5 font-medium"
            >
              {t('schemaEditor.review.after')}
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) =>
            'skipped' in item ? (
              <tr key={`skip-${index}`} data-kind="skipped">
                <td
                  colSpan={4}
                  className="bg-muted/60 px-2 py-1 text-center text-muted-foreground"
                >
                  {t('schemaEditor.review.unchanged', { count: item.skipped })}
                </td>
              </tr>
            ) : (
              <tr key={index} data-kind={item.kind}>
                <Side
                  line={item.left}
                  mark={MARK[item.kind].left}
                  className={ROW_STYLE[item.kind].left}
                />
                <Side
                  line={item.right}
                  mark={MARK[item.kind].right}
                  className={cn('border-l', ROW_STYLE[item.kind].right)}
                />
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}
