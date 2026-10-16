import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@configure-env/design-system/components/atoms/empty';
import { ScrollProgress } from '@configure-env/design-system/motion/scroll-progress';
import { PortalContainer } from '@configure-env/design-system/components/atoms/portal-container';
import { useQuery } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { type ReactNode, Suspense, lazy, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOpenShortcut } from '../features/editor/use-open-shortcut';
import { isUnauthorized, projectQuery } from '../lib/api';
import { useProjectEvents } from '../lib/use-project-events';
import { AppHeader } from './app-header';
import { AppSidebar } from './app-sidebar';

// The palette (cmdk and its dialog) and the mobile sheet load in their own
// chunks, after the first paint: the palette right away, so ⌘K is ready;
// the sheet the first time it opens.
const CommandMenu = lazy(() => import('./command-menu'));
const MobileNav = lazy(() => import('./mobile-nav'));

/**
 * The portal's frame: the sidebar (a sheet on small screens), the sticky
 * header with its scroll progress, the page, and the ⌘K palette.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [navUsed, setNavUsed] = useState(false);
  const project = useQuery(projectQuery);
  useProjectEvents();
  useOpenShortcut();

  if (isUnauthorized(project.error)) return <Unauthorized />;

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2"
      >
        {t('app.skipToContent')}
      </a>
      <ScrollProgress />

      <div className="flex">
        <AppSidebar className="hidden md:flex" />
        <div className="flex min-w-0 flex-1 flex-col">
          <AppHeader
            onOpenPalette={() => setPaletteOpen(true)}
            onOpenNav={() => {
              setNavUsed(true);
              setNavOpen(true);
            }}
          />
          <main
            id="main"
            tabIndex={-1}
            className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 outline-none md:px-8"
          >
            {/* Menus opened on a page portal into <main>, inside a landmark. */}
            <PortalContainer>{children}</PortalContainer>
          </main>
        </div>
      </div>

      <Suspense fallback={null}>
        {navUsed && <MobileNav open={navOpen} onOpenChange={setNavOpen} />}
        <CommandMenu open={paletteOpen} onOpenChange={setPaletteOpen} />
      </Suspense>
    </div>
  );
}

/** No session: the cookie is missing or belongs to an earlier run. */
function Unauthorized() {
  const { t } = useTranslation();
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-4 text-foreground">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <KeyRound aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>
            <h1 className="text-base">{t('launch.unauthorized.title')}</h1>
          </EmptyTitle>
          <EmptyDescription>
            {t('launch.unauthorized.description')}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </main>
  );
}
