import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@configure-env/design-system/components/atoms/sheet';
import { useTranslation } from 'react-i18next';
import { SidebarNav } from './sidebar-nav';
import { LanguageToggle } from './language-toggle';
import { ThemeToggle } from './theme-toggle';

/** The sidebar's links, the language and the theme in a sheet, for small screens. */
export default function MobileNav({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" closeLabel={t('nav.close')} className="p-4">
        <SheetHeader className="p-0">
          <SheetTitle>{t('app.name')}</SheetTitle>
        </SheetHeader>
        <SidebarNav
          indicatorId="sheet-nav"
          onNavigate={() => onOpenChange(false)}
        />
        <div className="mt-auto flex flex-wrap items-center gap-2">
          <LanguageToggle />
          <ThemeToggle />
        </div>
      </SheetContent>
    </Sheet>
  );
}
