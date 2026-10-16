// "Open in editor": asking the API to open a schema or env file at a line
// in the person's editor, and the toast that says how it went. Each item
// that can be opened wraps its button (open-in-editor.tsx) in an element
// marked `data-editor-item`, which the `o` shortcut (use-open-shortcut.ts)
// finds.

import {
  type OpenInEditorRequest,
  openInEditor,
} from '@configure-env/api-client';
import { toast } from '@configure-env/design-system/components/atoms/sonner';
import type { TFunction } from 'i18next';
import { unwrap } from '../../lib/api';

export type EditorTarget = OpenInEditorRequest;

/** The key that opens the focused or selected item. */
export const OPEN_SHORTCUT = 'o';
/** Marks an element whose button `o` presses. */
export const EDITOR_ITEM = 'data-editor-item';
/** Marks an Open in editor button. */
export const EDITOR_BUTTON = 'data-open-in-editor';

/** What the button opens, said in full for its accessible name. */
export function editorLabel(
  t: TFunction,
  { file, key, line, path }: EditorTarget,
): string {
  if (line !== undefined) return t('editor.line', { file, line });
  if (path !== undefined) return t('editor.path', { file, path });
  if (key !== undefined) return t('editor.key', { file, key });
  return t('editor.file', { file });
}

/** Opens a target, then says in a toast whether the editor started and why not. */
export async function openTarget(t: TFunction, target: EditorTarget) {
  const { file } = target;
  try {
    const result = await unwrap(openInEditor(target));
    if (result.opened)
      toast.success(t('editor.opened', { file, line: result.line }));
    else if (result.reason === 'no-editor')
      toast.error(t('editor.noEditor'), {
        description: t('editor.noEditorHint'),
      });
    else if (result.reason === 'terminal-editor')
      toast.error(t('editor.terminalEditor'), {
        description: result.message ?? t('editor.terminalEditorHint'),
      });
    else
      toast.error(t('editor.failed', { file }), {
        ...(result.message ? { description: result.message } : {}),
      });
  } catch (error) {
    toast.error(t('editor.error', { file, message: (error as Error).message }));
  }
}

/** The attribute that marks an item `o` can open. */
export const editorItem = { [EDITOR_ITEM]: '' };
