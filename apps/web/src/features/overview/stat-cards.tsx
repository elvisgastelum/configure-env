import { Card } from '@configure-env/design-system/components/atoms/card';
import { Skeleton } from '@configure-env/design-system/components/atoms/skeleton';
import {
  RevealGroup,
  RevealItem,
} from '@configure-env/design-system/motion/reveal';
import {
  KeyRound,
  Layers,
  type LucideIcon,
  Asterisk,
  Variable,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { VariableCounts } from './summary';

const STATS: readonly { key: keyof VariableCounts; icon: LucideIcon }[] = [
  { key: 'variables', icon: Variable },
  { key: 'secrets', icon: KeyRound },
  { key: 'required', icon: Asterisk },
  { key: 'groups', icon: Layers },
];

/** The four counts, revealed one after another; skeletons until known. */
export function StatCards({ counts }: { counts: VariableCounts | undefined }) {
  const { t } = useTranslation();
  return (
    <RevealGroup
      as="ul"
      trigger="mount"
      aria-label={t('overview.stats.label')}
      className="grid grid-cols-2 gap-3 lg:grid-cols-4"
    >
      {STATS.map(({ key, icon: Icon }) => (
        <RevealItem as="li" key={key}>
          <Card
            role="group"
            aria-label={t(`overview.stats.${key}`)}
            className="h-full px-4"
          >
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-sm">{t(`overview.stats.${key}`)}</span>
              <Icon aria-hidden="true" className="size-4" />
            </div>
            {counts ? (
              <span
                data-slot="stat-value"
                className="text-3xl font-semibold tracking-tight tabular-nums"
              >
                {counts[key]}
              </span>
            ) : (
              <Skeleton data-testid="overview-skeleton" className="h-9 w-12" />
            )}
          </Card>
        </RevealItem>
      ))}
    </RevealGroup>
  );
}
