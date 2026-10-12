import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@configure-env/design-system/components/atoms/empty';
import { TYPE } from '@configure-env/design-system/recipes';
import { Construction } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PageKey } from '../lib/nav';

type PlaceholderKey = Exclude<PageKey, 'overview'>;

/** A page the next tickets fill; it names what will live here. */
export function PlaceholderPage({
  page,
  focus,
}: {
  page: PlaceholderKey;
  /** The variable or file the palette jumped to. */
  focus?: string;
}) {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className={TYPE.subTitle}>{t(`nav.${page}`)}</h1>
        <p className="text-muted-foreground">{t(`placeholder.${page}`)}</p>
      </header>
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Construction aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>{t('placeholder.soon')}</EmptyTitle>
          {focus && (
            <EmptyDescription>
              {t('placeholder.focus', { name: focus })}
            </EmptyDescription>
          )}
        </EmptyHeader>
      </Empty>
    </section>
  );
}
