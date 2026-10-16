import type { Variable } from '@configure-env/api-client';
import { Button } from '@configure-env/design-system/components/atoms/button';
import { Checkbox } from '@configure-env/design-system/components/atoms/checkbox';
import { Input } from '@configure-env/design-system/components/atoms/input';
import { NumberInput } from '@configure-env/design-system/components/atoms/number-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@configure-env/design-system/components/atoms/select';
import { toast } from '@configure-env/design-system/components/atoms/sonner';
import { Spinner } from '@configure-env/design-system/components/atoms/spinner';
import { Switch } from '@configure-env/design-system/components/atoms/switch';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { undoToast } from '../history/undo-toast';
import { isProtected } from './model';
import { ConflictDialog } from './conflict-dialog';
import {
  type EditRequest,
  refusalMessages,
  staleFile,
  useDraftProblems,
  useValueEdit,
} from './use-value-edits';

const NUMERIC = new Set(['number', 'integer', 'port']);

/** The control that fits the variable's type, over a string draft; the apply flow prompts with it too. */
export function ValueControl({
  variable,
  label,
  draft,
  onDraftChange,
  invalid,
  describedBy,
}: {
  variable: Variable;
  label: string;
  draft: string;
  onDraftChange: (draft: string) => void;
  invalid: boolean;
  describedBy?: string;
}) {
  const { spec } = variable;
  const { t } = useTranslation();
  const common = {
    'aria-label': label,
    'aria-invalid': invalid || undefined,
    'aria-describedby': describedBy,
  };

  if (spec.type === 'enum')
    return (
      <Select
        items={spec.values.map((value) => ({ value, label: value }))}
        value={draft}
        onValueChange={(value) => {
          if (typeof value === 'string') onDraftChange(value);
        }}
      >
        <SelectTrigger {...common} className="w-full font-mono">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {spec.values.map((value) => (
            <SelectItem key={value} value={value} className="font-mono">
              {value}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );

  if (spec.type === 'boolean')
    return (
      <Switch
        {...common}
        checked={draft === 'true'}
        onCheckedChange={(checked) => onDraftChange(String(checked))}
      />
    );

  if (NUMERIC.has(spec.type))
    return (
      <NumberInput
        {...common}
        incrementLabel={t('variables.edit.increment')}
        decrementLabel={t('variables.edit.decrement')}
        value={
          draft === '' || Number.isNaN(Number(draft)) ? null : Number(draft)
        }
        step={spec.type === 'number' ? 0.1 : 1}
        format={{ useGrouping: false, maximumFractionDigits: 20 }}
        onValueChange={(value) =>
          onDraftChange(value === null ? '' : String(value))
        }
      />
    );

  return (
    <Input
      {...common}
      type={
        spec.secret
          ? 'password'
          : spec.type === 'url'
            ? 'url'
            : spec.type === 'email'
              ? 'email'
              : 'text'
      }
      autoComplete="off"
      spellCheck={false}
      className="font-mono"
      placeholder={spec.secret ? t('variables.edit.secretPlaceholder') : ''}
      value={draft}
      onChange={(event) => onDraftChange(event.target.value)}
    />
  );
}

/**
 * Edits one value of one file in place: a control that fits its type, the
 * core's messages as you type (checked by the API), and Save. A protected
 * value is replaced only once the box says so.
 */
export function ValueEditor({
  variable,
  file,
  onDone,
}: {
  variable: Variable;
  file: string;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { name, spec } = variable;
  const entry = variable.files.find((value) => value.file === file);
  // A secret starts empty: its value is never put in a field unasked.
  const initial = spec.secret ? '' : (entry?.value ?? '');
  const [draft, setDraft] = useState(initial);
  const [replace, setReplace] = useState(false);
  const edit = useValueEdit();
  const queryClient = useQueryClient();
  const problemsId = useId();
  const replaceId = useId();

  const changed = draft !== initial;
  const problems = useDraftProblems(file, name, draft, changed);
  const refused = refusalMessages(edit.error);
  const stale = staleFile(edit.error);
  const needsReplace = isProtected(spec) && entry?.value !== undefined;
  const label = t('variables.edit.label', { name, file });

  const messages = [
    ...(problems ?? []),
    ...(edit.isError && !edit.isPending && !stale
      ? refused.length
        ? refused.map((problem) =>
            problem.reason
              ? `${problem.message} (${problem.reason})`
              : problem.message,
          )
        : [edit.error.message]
      : []),
  ];

  const canSave =
    changed &&
    !edit.isPending &&
    (problems === undefined || problems.length === 0) &&
    (!needsReplace || replace) &&
    !(spec.secret && draft === '');

  /** Saves the draft, on top of `fingerprint` when given. */
  const save = (fingerprint?: string | null) => {
    const request: EditRequest = {
      kind: 'set',
      file,
      key: name,
      value: draft,
      ...(needsReplace ? { replaceProtected: true } : {}),
      ...(fingerprint !== undefined ? { fingerprint } : {}),
    };
    edit.mutate(request, {
      onSuccess: (written) => {
        toast.success(
          t('variables.edit.saved', { name, file }),
          undoToast(queryClient, t, written.changes),
        );
        onDone();
      },
    });
  };

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSave) save();
      }}
    >
      <ConflictDialog
        open={stale !== undefined}
        name={name}
        file={file}
        draft={draft}
        secret={spec.secret}
        onKeep={() => {
          edit.reset();
          onDone();
        }}
        onOverwrite={() => save(stale?.file.fingerprint ?? null)}
      />
      <ValueControl
        variable={variable}
        label={label}
        draft={draft}
        onDraftChange={(next) => {
          setDraft(next);
          edit.reset();
        }}
        invalid={messages.length > 0}
        describedBy={messages.length ? problemsId : undefined}
      />
      {messages.length > 0 && (
        <ul
          id={problemsId}
          role="alert"
          className="flex flex-col gap-0.5 text-xs text-destructive"
        >
          {messages.map((message) => (
            <li key={message}>
              {t('variables.edit.problem', { name, message })}
            </li>
          ))}
        </ul>
      )}
      {needsReplace && (
        <label className="flex items-center gap-2 text-xs">
          <Checkbox
            aria-labelledby={replaceId}
            checked={replace}
            onCheckedChange={(checked) => setReplace(checked === true)}
          />
          <span id={replaceId}>{t('variables.edit.replaceProtected')}</span>
        </label>
      )}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={!canSave}>
          {edit.isPending && <Spinner />}
          {t('variables.edit.save')}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          {t('variables.edit.cancel')}
        </Button>
        {changed && problems === undefined && (
          <span className="text-xs text-muted-foreground">
            {t('variables.edit.checking')}
          </span>
        )}
      </div>
    </form>
  );
}
