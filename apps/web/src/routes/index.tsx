import { TYPE } from '@configure-env/design-system/recipes';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

export const Route = createFileRoute('/')({
  component: Overview,
});

function Overview() {
  const { t } = useTranslation();
  return <h1 className={TYPE.subTitle}>{t('nav.overview')}</h1>;
}
