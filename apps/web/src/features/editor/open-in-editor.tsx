// The Open in editor button: an icon button that opens a target (see
// editor.ts) in the person's editor, its tooltip showing the `o` shortcut.

import { Button } from '@configure-env/design-system/components/atoms/button';
import { Kbd } from '@configure-env/design-system/components/atoms/kbd';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@configure-env/design-system/components/atoms/tooltip';
import { SquareArrowOutUpRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  EDITOR_BUTTON,
  type EditorTarget,
  OPEN_SHORTCUT,
  editorLabel,
  openTarget,
} from './editor';

/**
 * An icon button that opens `target` in the editor; its tooltip shows the
 * `o` shortcut. `label` overrides the accessible name built from the target.
 */
export function OpenInEditorButton({
  target,
  label,
}: {
  target: EditorTarget;
  label?: string;
}) {
  const { t } = useTranslation();
  const name = label ?? editorLabel(t, target);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={name}
            aria-keyshortcuts={OPEN_SHORTCUT}
            {...{ [EDITOR_BUTTON]: '' }}
            onClick={() => void openTarget(t, target)}
          />
        }
      >
        <SquareArrowOutUpRight aria-hidden="true" />
      </TooltipTrigger>
      <TooltipContent>
        {t('editor.open')}
        <Kbd>{OPEN_SHORTCUT}</Kbd>
      </TooltipContent>
    </Tooltip>
  );
}
