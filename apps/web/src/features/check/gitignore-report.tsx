import {
  type GitignoreFix,
  type GitignoreProblem,
  fixGitignore,
} from '@configure-env/api-client';
import { Button } from '@configure-env/design-system/components/atoms/button';
import { Card } from '@configure-env/design-system/components/atoms/card';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleX } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { checkQuery, unwrap } from '../../lib/api';

/**
 * The check report's git-ignore problems: what git could commit that it
 * must not, each with the lines its fix adds to a .gitignore, fixed one at
 * a time or all at once, as `check --fix` does. The report after the fix
 * replaces the shown one; what was written is announced, even once the
 * section is gone.
 */
export function GitignoreReport({
  problems,
  hidden = false,
}: {
  problems: readonly GitignoreProblem[];
  /** Under the warnings filter: the problems are errors. */
  hidden?: boolean;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const queryClient = useQueryClient();
  const [announcement, setAnnouncement] = useState('');
  const describe = (fix: GitignoreFix) =>
    t(fix.created ? 'check.gitignore.created' : 'check.gitignore.added', {
      gitignore: fix.gitignore,
      entries: fix.added.join(', '),
    });
  const fix = useMutation({
    mutationFn: (paths?: string[]) =>
      unwrap(fixGitignore(paths ? { paths } : {})),
    onMutate: () => setAnnouncement(''),
    onSuccess: ({ fixed, check }) => {
      queryClient.setQueryData(checkQuery.queryKey, check);
      setAnnouncement(
        fixed.length
          ? fixed.map(describe).join(' ')
          : t('check.gitignore.nothing'),
      );
    },
  });
  const fixable = problems.filter((problem) => !problem.blocked);
  return (
    <>
      {!hidden && problems.length > 0 && (
        <Card className="gap-3 px-4">
          <section aria-labelledby={titleId} className="flex flex-col gap-3">
            <header className="flex flex-wrap items-center gap-2">
              <h2 id={titleId} className="text-sm font-medium">
                {t('check.gitignore.title')}
              </h2>
              {fixable.length > 1 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto"
                  disabled={fix.isPending}
                  onClick={() => fix.mutate(undefined)}
                >
                  {t('check.gitignore.fixAll')}
                </Button>
              )}
            </header>
            <p className="text-sm text-pretty text-muted-foreground">
              {t('check.gitignore.lead')}
            </p>
            {fix.error && (
              <p role="alert" className="text-sm text-destructive">
                {t('check.gitignore.error', { message: fix.error.message })}
              </p>
            )}
            <ul className="flex flex-col gap-2 text-sm">
              {problems.map((problem) => {
                const values = {
                  gitignore: problem.gitignore,
                  entries: problem.entries.join(', '),
                };
                return (
                  <li
                    key={`${problem.code}:${problem.path}`}
                    className="flex flex-wrap items-center gap-x-1.5 gap-y-2 rounded-lg bg-muted/60 px-3 py-2"
                  >
                    <CircleX
                      aria-hidden="true"
                      className="size-4 shrink-0 text-destructive"
                    />
                    <span className="min-w-0 flex-1">
                      <code className="font-mono text-xs">{problem.path}</code>{' '}
                      {t(`check.gitignore.code.${problem.code}`)}{' '}
                      <span className="text-muted-foreground">
                        {problem.blocked
                          ? t('check.gitignore.symlink', values)
                          : t('check.gitignore.adds', values)}
                      </span>
                    </span>
                    {!problem.blocked && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={fix.isPending}
                        aria-label={t('check.gitignore.fixLabel', {
                          path: problem.path,
                        })}
                        onClick={() => fix.mutate([problem.path])}
                      >
                        {t('check.gitignore.fix')}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        </Card>
      )}
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </>
  );
}
