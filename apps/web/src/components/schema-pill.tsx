import { Badge } from '@configure-env/design-system/components/atoms/badge';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { CircleAlert, CircleCheck, CircleDashed } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { schemaQuery } from '../lib/api';
import { schemaStatus } from '../lib/schema-status';

/** The schema's state at a glance; it links to the schema page. */
export function SchemaPill() {
  const { t } = useTranslation();
  const { data } = useQuery(schemaQuery);

  if (!data)
    return (
      <Badge variant="outline" data-status="loading">
        <CircleDashed aria-hidden="true" data-icon="inline-start" />
        {t('schema.loading')}
      </Badge>
    );

  const status = schemaStatus(data);
  const content = {
    valid: {
      variant: 'secondary' as const,
      icon: CircleCheck,
      label: t('schema.valid'),
    },
    invalid: {
      variant: 'destructive' as const,
      icon: CircleAlert,
      label: t('schema.invalid', { count: data.errors.length }),
    },
    missing: {
      variant: 'outline' as const,
      icon: CircleDashed,
      label: t('schema.missing'),
    },
  }[status];
  const Icon = content.icon;

  return (
    <Badge
      variant={content.variant}
      data-status={status}
      render={<Link to="/schema" />}
    >
      <Icon aria-hidden="true" data-icon="inline-start" />
      {content.label}
    </Badge>
  );
}
