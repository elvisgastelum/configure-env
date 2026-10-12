import { Button } from '@configure-env/design-system/components/atoms/button';
import { Kbd } from '@configure-env/design-system/components/atoms/kbd';
import { Skeleton } from '@configure-env/design-system/components/atoms/skeleton';
import { useScrolled } from '@configure-env/design-system/motion/use-scrolled';
import { cn } from '@configure-env/design-system/utils';
import { useQuery } from '@tanstack/react-query';
import { Menu, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { projectQuery } from '../lib/api';
import { projectName } from '../lib/schema-status';
import { SchemaPill } from './schema-pill';
import { ThemeToggle } from './theme-toggle';

/**
 * The sticky header: the project, its schema's state, search and the theme.
 * Once the page scrolls it lifts off the content with a shadow and a blur.
 */
export function AppHeader({
  onOpenPalette,
  onOpenNav,
}: {
  onOpenPalette: () => void;
  onOpenNav: () => void;
}) {
  const { t } = useTranslation();
  const scrolled = useScrolled();
  const { data: project } = useQuery(projectQuery);

  return (
    <header
      data-testid="app-header"
      data-scrolled={scrolled}
      className={cn(
        'sticky top-0 z-40 flex h-16 items-center gap-3 border-b border-transparent bg-background/80 px-4 transition-[box-shadow,border-color,backdrop-filter] duration-300 md:px-8',
        scrolled && 'border-border/60 shadow-sm backdrop-blur-md',
      )}
    >
      <Button
        variant="ghost"
        size="icon-sm"
        className="md:hidden"
        aria-label={t('nav.open')}
        onClick={onOpenNav}
      >
        <Menu aria-hidden="true" />
      </Button>

      <div className="flex min-w-0 flex-1 flex-col">
        {project ? (
          <>
            <span className="truncate text-sm font-semibold">
              {projectName(project.root)}
            </span>
            <span
              className="truncate font-mono text-xs text-muted-foreground"
              title={project.root}
            >
              <span className="sr-only">{t('header.root')}: </span>
              {project.root}
            </span>
          </>
        ) : (
          <div aria-label={t('header.projectLoading')} role="status">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="mt-1 h-3 w-48" />
          </div>
        )}
      </div>

      <SchemaPill />

      <Button
        variant="outline"
        size="sm"
        onClick={onOpenPalette}
        aria-keyshortcuts="Meta+K Control+K"
        title={t('header.searchHint')}
      >
        <Search aria-hidden="true" data-icon="inline-start" />
        <span className="hidden sm:inline">{t('header.search')}</span>
        <Kbd className="hidden sm:inline-flex">⌘K</Kbd>
      </Button>

      <ThemeToggle className="hidden sm:inline-flex" />
    </header>
  );
}
