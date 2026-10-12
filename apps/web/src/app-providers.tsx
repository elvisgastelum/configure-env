// Everything the portal renders inside: the query client, the copy, the
// shared motion defaults (easing, and reduced motion honored everywhere)
// and the tooltip delay group.

import { TooltipProvider } from '@configure-env/design-system/components/atoms/tooltip';
import { SiteMotionConfig } from '@configure-env/design-system/motion/site-motion-config';
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { i18n } from 'i18next';
import { type ReactNode, useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { createI18n } from './i18n';

export function AppProviders({
  queryClient,
  i18n,
  children,
}: {
  queryClient: QueryClient;
  i18n?: i18n;
  children: ReactNode;
}) {
  const [instance] = useState(() => i18n ?? createI18n());
  return (
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={instance}>
        <SiteMotionConfig>
          <TooltipProvider>{children}</TooltipProvider>
        </SiteMotionConfig>
      </I18nextProvider>
    </QueryClientProvider>
  );
}
