import { Button } from '@configure-env/design-system/components/atoms/button';
import { cn } from '@configure-env/design-system/utils';
import { PanelLeftClose, PanelLeftOpen, SlidersHorizontal } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SidebarNav } from './sidebar-nav';

const WIDTH = { expanded: 232, collapsed: 64 } as const;

/**
 * The desktop sidebar: the brand and the page links. It collapses to icons;
 * its width animates (instantly under reduced motion).
 */
export function AppSidebar({ className }: { className?: string }) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const Toggle = collapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <motion.aside
      data-testid="app-sidebar"
      data-collapsed={collapsed}
      initial={false}
      animate={{ width: collapsed ? WIDTH.collapsed : WIDTH.expanded }}
      className={cn(
        'sticky top-0 h-dvh shrink-0 flex-col gap-6 overflow-hidden border-r border-border/60 bg-sidebar/60 px-3 py-4',
        className,
      )}
    >
      <div
        className={cn(
          'flex h-8 items-center gap-2 px-2 font-semibold tracking-tight',
          collapsed && 'justify-center px-0',
        )}
      >
        <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <SlidersHorizontal aria-hidden="true" className="size-4" />
        </span>
        <span className={cn('truncate', collapsed && 'sr-only')}>
          {t('app.name')}
        </span>
      </div>

      <SidebarNav collapsed={collapsed} />

      <Button
        variant="ghost"
        size="icon-sm"
        className="mt-auto self-center"
        aria-label={collapsed ? t('nav.expand') : t('nav.collapse')}
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((value) => !value)}
      >
        <Toggle aria-hidden="true" />
      </Button>
    </motion.aside>
  );
}
