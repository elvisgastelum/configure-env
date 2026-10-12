import { Badge } from '@configure-env/design-system/components/atoms/badge';
import { useTranslation } from 'react-i18next';
import type { VariableStatus } from './model';

const VARIANT = {
  missing: 'outline',
  invalid: 'destructive',
  drift: 'secondary',
} as const;

/** A variable's problems as small badges, or a quiet OK. */
export function StatusBadges({
  statuses,
}: {
  statuses: readonly VariableStatus[];
}) {
  const { t } = useTranslation();
  if (statuses.length === 0)
    return (
      <span
        className="text-xs text-muted-foreground"
        title={t('variables.statusHint.ok')}
      >
        {t('variables.status.ok')}
      </span>
    );
  return (
    <span className="flex flex-wrap gap-1">
      {statuses.map((status) => (
        <Badge
          key={status}
          variant={VARIANT[status]}
          title={t(`variables.statusHint.${status}`)}
        >
          {t(`variables.status.${status}`)}
        </Badge>
      ))}
    </span>
  );
}
