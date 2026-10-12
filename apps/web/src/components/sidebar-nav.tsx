import { ActiveIndicator } from '@configure-env/design-system/motion/active-indicator';
import { FOCUS_RING } from '@configure-env/design-system/recipes';
import { cn } from '@configure-env/design-system/utils';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { NAV_ITEMS } from '../lib/nav';

/**
 * The portal's pages as links. The active one carries `aria-current="page"`
 * and a pill that slides between items as the route changes. Collapsed, the
 * labels stay for assistive tech and as tooltips, but only icons show.
 */
export function SidebarNav({
  collapsed = false,
  indicatorId = 'sidebar-nav',
  onNavigate,
}: {
  collapsed?: boolean;
  /** Distinct per rendered nav, so two navs never share one pill. */
  indicatorId?: string;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();

  return (
    <nav aria-label={t('nav.label')}>
      <ul className="flex flex-col gap-1">
        {NAV_ITEMS.map(({ key, to, icon: Icon }) => (
          <li key={key}>
            <Link
              to={to}
              activeOptions={{ exact: to === '/', includeSearch: false }}
              onClick={onNavigate}
              title={collapsed ? t(`nav.${key}`) : undefined}
              className={cn(
                'relative isolate flex h-9 items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:text-foreground',
                collapsed && 'justify-center px-0',
                FOCUS_RING,
              )}
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <ActiveIndicator
                      layoutId={indicatorId}
                      testId={`${indicatorId}-indicator`}
                      className="rounded-lg bg-muted"
                    />
                  )}
                  <Icon aria-hidden="true" className="size-4 shrink-0" />
                  <span className={cn('truncate', collapsed && 'sr-only')}>
                    {t(`nav.${key}`)}
                  </span>
                </>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
