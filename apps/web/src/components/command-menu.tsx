import {
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@configure-env/design-system/components/atoms/command';
import { CommandPalette } from '@configure-env/design-system/components/molecules/command-palette';
import {
  THEME_PREFERENCES,
  setThemePreference,
} from '@configure-env/design-system/theme';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  FileText,
  Palette,
  ScanSearch,
  ShieldCheck,
  Variable,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  checkQuery,
  filesQuery,
  schemaQuery,
  validateQuery,
  variablesQuery,
} from '../lib/api';
import { NAV_ITEMS } from '../lib/nav';

/**
 * The ⌘K palette: every page, every variable and env file of the schema,
 * and the actions (run check or validate, switch the theme). The shell
 * owns its open state, so the header's search button opens it too.
 */
export default function CommandMenu({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: schema } = useQuery(schemaQuery);
  const enabled = open && schema?.valid === true;
  const { data: variables } = useQuery({ ...variablesQuery, enabled });
  const { data: files } = useQuery({ ...filesQuery, enabled });

  const run = (action: () => void) => () => {
    onOpenChange(false);
    action();
  };

  return (
    <CommandPalette
      title={t('palette.title')}
      description={t('palette.description')}
      placeholder={t('palette.placeholder')}
      open={open}
      onOpenChange={onOpenChange}
    >
      <CommandList>
        <CommandEmpty>{t('palette.empty')}</CommandEmpty>
        <CommandGroup heading={t('palette.pages')}>
          {NAV_ITEMS.map(({ key, to, icon: Icon }) => (
            <CommandItem
              key={key}
              value={`page ${t(`nav.${key}`)}`}
              onSelect={run(() => void navigate({ to }))}
            >
              <Icon aria-hidden="true" />
              {t(`nav.${key}`)}
            </CommandItem>
          ))}
        </CommandGroup>

        {variables && variables.variables.length > 0 && (
          <CommandGroup heading={t('palette.variables')}>
            {variables.variables.map(({ name, spec }) => (
              <CommandItem
                key={name}
                value={`variable ${name}`}
                keywords={spec.group ? [spec.group] : []}
                onSelect={run(
                  () =>
                    void navigate({
                      to: '/variables',
                      search: { focus: name },
                    }),
                )}
              >
                <Variable aria-hidden="true" />
                <span className="font-mono">{name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {files && files.files.length > 0 && (
          <CommandGroup heading={t('palette.files')}>
            {files.files.map(({ path }) => (
              <CommandItem
                key={path}
                value={`file ${path}`}
                onSelect={run(
                  () =>
                    void navigate({ to: '/files', search: { focus: path } }),
                )}
              >
                <FileText aria-hidden="true" />
                <span className="font-mono">{path}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandGroup heading={t('palette.actions')}>
          <CommandItem
            value={`action ${t('palette.runCheck')}`}
            onSelect={run(() => {
              void queryClient.invalidateQueries(checkQuery);
              void navigate({ to: '/check' });
            })}
          >
            <ScanSearch aria-hidden="true" />
            {t('palette.runCheck')}
          </CommandItem>
          <CommandItem
            value={`action ${t('palette.runValidate')}`}
            onSelect={run(() => {
              void queryClient.invalidateQueries(validateQuery);
              void navigate({ to: '/validate' });
            })}
          >
            <ShieldCheck aria-hidden="true" />
            {t('palette.runValidate')}
          </CommandItem>
          {THEME_PREFERENCES.map((preference) => {
            const label = t('palette.theme', {
              theme: t(`theme.${preference}`).toLowerCase(),
            });
            return (
              <CommandItem
                key={preference}
                value={`action ${label}`}
                onSelect={run(() => setThemePreference(preference))}
              >
                <Palette aria-hidden="true" />
                {label}
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </CommandPalette>
  );
}
