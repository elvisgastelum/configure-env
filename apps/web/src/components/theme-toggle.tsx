import { FOCUS_RING } from '@configure-env/design-system/recipes';
import { ActiveIndicator } from '@configure-env/design-system/motion/active-indicator';
import {
  THEME_PREFERENCES,
  type ThemePreference,
  setThemePreference,
} from '@configure-env/design-system/theme';
import { useThemePreference } from '@configure-env/design-system/theme/use-theme-preference';
import { cn } from '@configure-env/design-system/utils';
import { type LucideIcon, Monitor, Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const ICONS: Record<ThemePreference, LucideIcon> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
};

/**
 * System, light or dark, as three pressed-state buttons. The pick is stored
 * on this device and applied to `<html>` (the design system's theme); the
 * pill slides to the new pick.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { t } = useTranslation();
  const current = useThemePreference();

  return (
    <div
      role="group"
      aria-label={t('theme.label')}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full bg-muted p-0.5',
        className,
      )}
    >
      {THEME_PREFERENCES.map((preference) => {
        const Icon = ICONS[preference];
        const active = preference === current;
        return (
          <button
            key={preference}
            type="button"
            aria-pressed={active}
            aria-label={t(`theme.${preference}`)}
            title={t(`theme.${preference}`)}
            onClick={() => setThemePreference(preference)}
            className={cn(
              'relative isolate inline-flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground aria-pressed:text-foreground',
              FOCUS_RING,
            )}
          >
            {active && (
              <ActiveIndicator
                layoutId="theme-toggle"
                testId="theme-toggle-indicator"
                className="bg-background shadow-sm"
              />
            )}
            <Icon aria-hidden="true" className="size-3.5" />
          </button>
        );
      })}
    </div>
  );
}
