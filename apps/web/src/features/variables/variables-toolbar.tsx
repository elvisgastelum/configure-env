import { Button } from '@configure-env/design-system/components/atoms/button';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@configure-env/design-system/components/atoms/input-group';
import { Kbd } from '@configure-env/design-system/components/atoms/kbd';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@configure-env/design-system/components/atoms/select';
import { Search, X } from 'lucide-react';
import type { Ref } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type Filters,
  SORT_ORDERS,
  type SortOrder,
  type StatusFilter,
  VARIABLE_STATUSES,
  activeFilterCount,
} from './model';

/** Base UI selects need a value for "any": this one never names a choice. */
const ANY = '\u0000any';
/** The ungrouped variables' value in the group select. */
const UNGROUPED = '\u0000ungrouped';

interface Option {
  value: string;
  label: string;
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
}) {
  return (
    <Select
      items={options}
      value={value}
      onValueChange={(next) => {
        if (typeof next === 'string') onChange(next);
      }}
    >
      <SelectTrigger aria-label={label} size="sm" className="min-w-28">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Toggle({
  pressed,
  onPressedChange,
  children,
}: {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  children: string;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={pressed ? 'secondary' : 'outline'}
      aria-pressed={pressed}
      onClick={() => onPressedChange(!pressed)}
    >
      {children}
    </Button>
  );
}

/** The search box, the filters and the sort above the table. */
export function VariablesToolbar({
  filters,
  onFiltersChange,
  sort,
  onSortChange,
  types,
  groups,
  hasUngrouped,
  files,
  searchRef,
}: {
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
  sort: SortOrder;
  onSortChange: (sort: SortOrder) => void;
  types: readonly string[];
  groups: readonly string[];
  hasUngrouped: boolean;
  files: readonly string[];
  searchRef?: Ref<HTMLInputElement>;
}) {
  const { t } = useTranslation();
  const set = (changes: Partial<Filters>) =>
    onFiltersChange({ ...filters, ...changes });
  const orUndefined = (value: string) => (value === ANY ? undefined : value);

  const groupValue =
    filters.group === undefined
      ? ANY
      : filters.group === null
        ? UNGROUPED
        : filters.group;

  return (
    <div
      role="search"
      aria-label={t('variables.filters.label')}
      className="flex flex-col gap-3"
    >
      <InputGroup>
        <InputGroupAddon>
          <Search aria-hidden="true" />
        </InputGroupAddon>
        <InputGroupInput
          ref={searchRef}
          type="search"
          aria-label={t('variables.search')}
          placeholder={t('variables.searchPlaceholder')}
          value={filters.query}
          onChange={(event) => set({ query: event.target.value })}
        />
        <InputGroupAddon align="inline-end">
          <Kbd>/</Kbd>
        </InputGroupAddon>
      </InputGroup>

      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          label={t('variables.filters.type')}
          value={filters.type ?? ANY}
          options={[
            { value: ANY, label: t('variables.filters.anyType') },
            ...types.map((type) => ({ value: type, label: type })),
          ]}
          onChange={(value) =>
            set({ type: orUndefined(value) as Filters['type'] })
          }
        />
        <FilterSelect
          label={t('variables.filters.group')}
          value={groupValue}
          options={[
            { value: ANY, label: t('variables.filters.anyGroup') },
            ...groups.map((group) => ({ value: group, label: group })),
            ...(hasUngrouped
              ? [{ value: UNGROUPED, label: t('variables.filters.ungrouped') }]
              : []),
          ]}
          onChange={(value) =>
            set({
              group:
                value === ANY ? undefined : value === UNGROUPED ? null : value,
            })
          }
        />
        <FilterSelect
          label={t('variables.filters.file')}
          value={filters.file ?? ANY}
          options={[
            { value: ANY, label: t('variables.filters.anyFile') },
            ...files.map((file) => ({ value: file, label: file })),
          ]}
          onChange={(value) => set({ file: orUndefined(value) })}
        />
        <FilterSelect
          label={t('variables.filters.status')}
          value={filters.status ?? ANY}
          options={[
            { value: ANY, label: t('variables.filters.anyStatus') },
            ...[...VARIABLE_STATUSES, 'ok' as const].map((status) => ({
              value: status,
              label: t(`variables.status.${status}`),
            })),
          ]}
          onChange={(value) =>
            set({ status: orUndefined(value) as StatusFilter | undefined })
          }
        />
        <Toggle
          pressed={filters.required === true}
          onPressedChange={(required) => set({ required })}
        >
          {t('variables.filters.required')}
        </Toggle>
        <Toggle
          pressed={filters.secret === true}
          onPressedChange={(secret) => set({ secret })}
        >
          {t('variables.filters.secret')}
        </Toggle>
        <Toggle
          pressed={filters.protected === true}
          onPressedChange={(on) => set({ protected: on })}
        >
          {t('variables.filters.protected')}
        </Toggle>
        {activeFilterCount(filters) > 0 && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onFiltersChange({ query: filters.query })}
          >
            <X aria-hidden="true" />
            {t('variables.filters.clear')}
          </Button>
        )}
        <div className="ml-auto">
          <FilterSelect
            label={t('variables.sort.label')}
            value={sort}
            options={SORT_ORDERS.map((order) => ({
              value: order,
              label: t(`variables.sort.${order}`),
            }))}
            onChange={(value) => onSortChange(value as SortOrder)}
          />
        </div>
      </div>
    </div>
  );
}
