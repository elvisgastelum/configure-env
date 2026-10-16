import type { Variable } from '@configure-env/api-client';
import { Badge } from '@configure-env/design-system/components/atoms/badge';
import { Button } from '@configure-env/design-system/components/atoms/button';
import { Sparkles } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { ValueControl } from '../variables/value-editor';
import { canGenerate, generateSecret } from './generate';
import { byGroup } from './needed';

/**
 * A prompt per needed value, by group, as the TUI asks them: the control
 * that fits the type, started at the default, with Generate for a secret
 * string; the plan's messages about a value under it.
 */
export function ValuesStep({
  variables,
  valueOf,
  onChange,
  problemsOf,
}: {
  variables: readonly Variable[];
  valueOf: (variable: Variable) => string;
  onChange: (name: string, value: string) => void;
  /** The last plan's messages about a key. */
  problemsOf: (name: string) => string[];
}) {
  const { t } = useTranslation();
  if (variables.length === 0)
    return (
      <p className="text-sm text-muted-foreground">{t('apply.values.none')}</p>
    );
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">{t('apply.values.lead')}</p>
      {byGroup(variables).map(([group, members]) => (
        <section key={group ?? ''} className="flex flex-col gap-3">
          {group && (
            <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {group}
            </h3>
          )}
          {members.map((variable) => (
            <Prompt
              key={variable.name}
              variable={variable}
              value={valueOf(variable)}
              onChange={(value) => onChange(variable.name, value)}
              problems={problemsOf(variable.name)}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

function Prompt({
  variable,
  value,
  onChange,
  problems,
}: {
  variable: Variable;
  value: string;
  onChange: (value: string) => void;
  problems: string[];
}) {
  const { t } = useTranslation();
  const { name, spec } = variable;
  const hintId = useId();
  const problemsId = useId();
  const described = [
    spec.description ? hintId : undefined,
    problems.length ? problemsId : undefined,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div
      role="group"
      aria-label={t('apply.values.label', { name })}
      className="flex flex-col gap-1.5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-medium">{name}</span>
        {spec.required && (
          <Badge variant="outline">{t('apply.values.required')}</Badge>
        )}
      </div>
      {spec.description && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {spec.description}
        </p>
      )}
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <ValueControl
            variable={variable}
            label={name}
            draft={value}
            onDraftChange={onChange}
            invalid={problems.length > 0}
            describedBy={described || undefined}
          />
        </div>
        {canGenerate(spec) && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={t('apply.values.generate', { name })}
            onClick={() => {
              const generated = generateSecret(spec);
              if (generated !== undefined) onChange(generated);
            }}
          >
            <Sparkles aria-hidden="true" data-icon="inline-start" />
            {t('apply.values.generateShort')}
          </Button>
        )}
      </div>
      {problems.length > 0 && (
        <ul id={problemsId} className="text-xs text-destructive">
          {problems.map((problem) => (
            <li key={problem}>
              {t('apply.values.problem', { name, message: problem })}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
