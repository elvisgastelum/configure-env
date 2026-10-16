import { FOCUS_RING } from '@configure-env/design-system/recipes';
import { ActiveIndicator } from '@configure-env/design-system/motion/active-indicator';
import { cn } from '@configure-env/design-system/utils';
import { useTranslation } from 'react-i18next';
import { LANGUAGES, currentLanguage, setLanguage } from '../i18n';

/**
 * English or Spanish, as pressed-state buttons. Each is named in its own
 * language, so a person who can't read the current one still finds theirs.
 * The pick is stored on this device; `<html lang>` follows it.
 */
export function LanguageToggle({ className }: { className?: string }) {
  const { t, i18n } = useTranslation();
  const current = currentLanguage(i18n);

  return (
    <div
      role="group"
      aria-label={t('language.label')}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full bg-muted p-0.5',
        className,
      )}
    >
      {LANGUAGES.map((language) => {
        const active = language === current;
        return (
          <button
            key={language}
            type="button"
            lang={language}
            aria-pressed={active}
            aria-label={t(`language.${language}`)}
            title={t(`language.${language}`)}
            onClick={() => void setLanguage(i18n, language)}
            className={cn(
              'relative isolate inline-flex h-7 min-w-7 items-center justify-center rounded-full px-1.5 font-mono text-[0.6875rem] font-medium uppercase text-muted-foreground transition-colors hover:text-foreground aria-pressed:text-foreground',
              FOCUS_RING,
            )}
          >
            {active && (
              <ActiveIndicator
                layoutId="language-toggle"
                testId="language-toggle-indicator"
                className="bg-background shadow-sm"
              />
            )}
            <span aria-hidden="true">{language}</span>
          </button>
        );
      })}
    </div>
  );
}
