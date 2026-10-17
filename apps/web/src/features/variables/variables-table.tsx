import type { FileInfo, Variable } from '@configure-env/api-client';
import { Badge } from '@configure-env/design-system/components/atoms/badge';
import { cn } from '@configure-env/design-system/utils';
import {
  type Range,
  defaultRangeExtractor,
  useVirtualizer,
} from '@tanstack/react-virtual';
import { Asterisk, KeyRound, Lock } from 'lucide-react';
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  type Section,
  isProtected,
  protectedReason,
  rowId,
  statusesOf,
} from './model';
import { StatusBadges } from './status-badges';
import { editorItem } from '../editor/editor';

/** From this many rows on, only the rows in view are rendered. */
export const VIRTUALIZE_AT = 200;
const HEADER_HEIGHT = 36;
const GROUP_HEIGHT = 36;
const ROW_HEIGHT = 56;

/** The table's columns: name, type, value, status, actions. */
const COLUMNS =
  'grid min-w-[46rem] grid-cols-[minmax(14rem,2fr)_7rem_minmax(10rem,2fr)_10rem_5rem] items-center gap-3 px-3';

type Item =
  | { kind: 'group'; group: string | null; count: number }
  | { kind: 'variable'; variable: Variable };

function itemsOf(sections: readonly Section[]): Item[] {
  return sections.flatMap((section): Item[] => [
    { kind: 'group', group: section.group, count: section.variables.length },
    ...section.variables.map((variable): Item => ({
      kind: 'variable',
      variable,
    })),
  ]);
}

export interface VariablesTableProps {
  sections: readonly Section[];
  files: readonly FileInfo[];
  /** The file whose values the value column shows. */
  valueFile?: string;
  /** The status column looks at this file alone when set. */
  statusFile?: string;
  selected?: string;
  onSelect: (name: string) => void;
  onOpen: (name: string) => void;
  /** The value cell of a row; the plain value when absent. */
  renderValue?: (variable: Variable, file: string) => ReactNode;
  /** The trailing actions of a row. */
  renderActions?: (variable: Variable) => ReactNode;
  /** Extra controls on a group heading. */
  renderGroupActions?: (group: string | null) => ReactNode;
  empty: ReactNode;
}

/**
 * The variables, grouped under sticky headings. A large schema renders only
 * the rows in view; its current group heading stays on top as it scrolls.
 */
export function VariablesTable(props: VariablesTableProps) {
  const { t } = useTranslation();
  const { sections, selected } = props;
  const items = useMemo(() => itemsOf(sections), [sections]);
  const virtual = items.length > VIRTUALIZE_AT;
  const variableCount = items.filter((item) => item.kind === 'variable').length;
  // State, not a ref: the rows' virtualizer needs a render once it is set.
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(
    null,
  );

  return (
    <div
      ref={setScrollElement}
      role="grid"
      aria-label={t('nav.variables')}
      aria-rowcount={items.length + 1}
      aria-activedescendant={selected ? rowId(selected) : undefined}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && selected) props.onOpen(selected);
      }}
      className="relative max-h-[calc(100dvh-18rem)] min-h-64 overflow-auto rounded-xl border bg-card outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <div
        role="row"
        aria-rowindex={1}
        style={{ height: HEADER_HEIGHT }}
        className={cn(
          COLUMNS,
          'sticky top-0 z-20 border-b bg-muted/80 text-xs font-medium text-muted-foreground backdrop-blur',
        )}
      >
        <div role="columnheader">{t('variables.columns.name')}</div>
        <div role="columnheader">{t('variables.columns.type')}</div>
        <div role="columnheader">
          {props.valueFile
            ? t('variables.columns.value', { file: props.valueFile })
            : t('variables.columns.valueNoFile')}
        </div>
        <div role="columnheader">{t('variables.columns.status')}</div>
        <div role="columnheader">
          <span className="sr-only">{t('variables.columns.actions')}</span>
        </div>
      </div>
      {variableCount === 0 ? (
        <div className="p-8 text-center text-muted-foreground">
          {props.empty}
        </div>
      ) : virtual ? (
        <VirtualRows {...props} items={items} scrollElement={scrollElement} />
      ) : (
        <PlainRows {...props} items={items} />
      )}
    </div>
  );
}

type RowsProps = VariablesTableProps & { items: Item[] };

function PlainRows({ items, ...props }: RowsProps) {
  const { selected } = props;
  useEffect(() => {
    if (!selected) return;
    document
      .getElementById(rowId(selected))
      ?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  return items.map((item, index) =>
    item.kind === 'group' ? (
      <GroupRow
        key={`group-${item.group}`}
        item={item}
        index={index}
        style={{ top: HEADER_HEIGHT }}
        className="sticky z-10"
        {...props}
      />
    ) : (
      <VariableRow
        key={item.variable.name}
        variable={item.variable}
        index={index}
        {...props}
      />
    ),
  );
}

function VirtualRows({
  items,
  scrollElement,
  ...props
}: RowsProps & { scrollElement: HTMLDivElement | null }) {
  const groupIndexes = useMemo(
    () =>
      items.flatMap((item, index) => (item.kind === 'group' ? [index] : [])),
    [items],
  );
  const activeGroup = useRef(0);

  const rangeExtractor = useCallback(
    (range: Range) => {
      activeGroup.current =
        groupIndexes.findLast((index) => index <= range.startIndex) ?? 0;
      const indexes = new Set([
        activeGroup.current,
        ...defaultRangeExtractor(range),
      ]);
      return [...indexes].sort((a, b) => a - b);
    },
    [groupIndexes],
  );

  // The virtualizer re-renders this component itself as it scrolls.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollElement,
    estimateSize: (index) =>
      items[index]?.kind === 'group' ? GROUP_HEIGHT : ROW_HEIGHT,
    overscan: 8,
    scrollMargin: HEADER_HEIGHT,
    rangeExtractor,
  });

  const { selected } = props;
  useEffect(() => {
    if (!selected) return;
    const index = items.findIndex(
      (item) => item.kind === 'variable' && item.variable.name === selected,
    );
    if (index >= 0) virtualizer.scrollToIndex(index, { align: 'auto' });
  }, [selected, items, virtualizer]);

  return (
    <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
      {virtualizer.getVirtualItems().map((virtualItem) => {
        const item = items[virtualItem.index]!;
        const sticky =
          item.kind === 'group' && virtualItem.index === activeGroup.current;
        const style: CSSProperties = sticky
          ? { position: 'sticky', top: HEADER_HEIGHT, zIndex: 10 }
          : {
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              transform: `translateY(${virtualItem.start - HEADER_HEIGHT}px)`,
            };
        return item.kind === 'group' ? (
          <GroupRow
            key={virtualItem.key}
            item={item}
            index={virtualItem.index}
            style={style}
            {...props}
          />
        ) : (
          <VariableRow
            key={virtualItem.key}
            variable={item.variable}
            index={virtualItem.index}
            style={style}
            {...props}
          />
        );
      })}
    </div>
  );
}

function GroupRow({
  item,
  index,
  style,
  className,
  renderGroupActions,
}: VariablesTableProps & {
  item: Extract<Item, { kind: 'group' }>;
  index: number;
  style?: CSSProperties;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="row"
      aria-rowindex={index + 2}
      data-group={item.group ?? ''}
      style={{ ...style, height: GROUP_HEIGHT }}
      className={cn(
        'flex min-w-[46rem] items-center gap-2 border-b bg-card/95 px-3 backdrop-blur',
        className,
      )}
    >
      <div
        role="rowheader"
        aria-colspan={4}
        className="flex flex-1 items-center gap-2 text-sm font-semibold"
      >
        {item.group ?? t('variables.filters.ungrouped')}
        <Badge variant="secondary">{item.count}</Badge>
      </div>
      {/* A row may only hold cells: the group's actions take the last column. */}
      <div role="gridcell">{renderGroupActions?.(item.group)}</div>
    </div>
  );
}

function VariableRow({
  variable,
  index,
  style,
  files,
  valueFile,
  statusFile,
  selected,
  onSelect,
  onOpen,
  renderValue,
  renderActions,
}: VariablesTableProps & {
  variable: Variable;
  index: number;
  style?: CSSProperties;
}) {
  const { t } = useTranslation();
  const { name, spec } = variable;
  const isSelected = selected === name;
  const reason = protectedReason(spec);
  const protectedLabel = reason
    ? t('variables.protected.because', { reason })
    : t('variables.protected.title');
  return (
    <div
      role="row"
      id={rowId(name)}
      aria-rowindex={index + 2}
      aria-selected={isSelected}
      data-variable={name}
      {...editorItem}
      style={{ ...style, height: ROW_HEIGHT }}
      onClick={() => onSelect(name)}
      onDoubleClick={() => onOpen(name)}
      className={cn(
        COLUMNS,
        'cursor-default border-b transition-colors last:border-b-0 hover:bg-muted/50',
        isSelected && 'bg-accent hover:bg-accent',
      )}
    >
      <div role="rowheader" className="flex min-w-0 flex-col">
        <span className="flex items-center gap-1.5">
          <button
            type="button"
            tabIndex={-1}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(name);
              onOpen(name);
            }}
            className="truncate font-mono text-sm font-medium hover:underline"
          >
            {name}
          </button>
          {spec.required && (
            <Asterisk
              role="img"
              aria-label={t('variables.flags.required')}
              className="size-3 shrink-0 text-muted-foreground"
            />
          )}
          {spec.secret && (
            <KeyRound
              role="img"
              aria-label={t('variables.flags.secret')}
              className="size-3 shrink-0 text-muted-foreground"
            />
          )}
          {isProtected(spec) && (
            <span title={protectedLabel} className="inline-flex">
              <Lock
                role="img"
                aria-label={protectedLabel}
                className="size-3 shrink-0 text-amber-600 dark:text-amber-400"
              />
            </span>
          )}
        </span>
        {spec.description && (
          <span className="truncate text-xs text-muted-foreground">
            {spec.description}
          </span>
        )}
      </div>
      <div role="gridcell">
        <Badge variant="outline" className="font-mono">
          {spec.type}
        </Badge>
      </div>
      <div role="gridcell" className="min-w-0">
        {valueFile ? (
          renderValue ? (
            renderValue(variable, valueFile)
          ) : (
            <PlainValue variable={variable} file={valueFile} />
          )
        ) : null}
      </div>
      <div role="gridcell">
        <StatusBadges statuses={statusesOf(variable, files, statusFile)} />
      </div>
      <div role="gridcell" className="flex justify-end">
        {renderActions?.(variable)}
      </div>
    </div>
  );
}

/** A value as the API shows it: masked when secret, or why it is absent. */
export function PlainValue({
  variable,
  file,
}: {
  variable: Variable;
  file: string;
}) {
  const { t } = useTranslation();
  const value = variable.files.find((entry) => entry.file === file);
  if (!value)
    return (
      <span className="text-xs text-muted-foreground italic">
        {t('variables.notListed')}
      </span>
    );
  if (value.value === undefined)
    return (
      <span className="text-xs text-muted-foreground italic">
        {t('variables.notSet')}
      </span>
    );
  return (
    <span
      className={cn(
        'block truncate font-mono text-sm',
        value.status === 'invalid' && 'text-destructive',
      )}
    >
      {value.value}
    </span>
  );
}
