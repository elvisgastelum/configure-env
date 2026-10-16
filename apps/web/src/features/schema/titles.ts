import type { TFunction } from 'i18next';
import type { SchemaEdit } from './edits';

/** What the edit does, in a few words, for the review's title. */
export function editTitle(t: TFunction, edit: SchemaEdit): string {
  switch (edit.kind) {
    case 'addVariable':
      return t('schemaEditor.titles.addVariable', { name: edit.name });
    case 'updateVariable':
      return edit.rename &&
        edit.rename !== edit.name &&
        Object.keys(edit.changes).length === 0
        ? t('schemaEditor.titles.renameVariable', {
            name: edit.name,
            to: edit.rename,
          })
        : t('schemaEditor.titles.updateVariable', { name: edit.name });
    case 'removeVariable':
      return t('schemaEditor.titles.removeVariable', { name: edit.name });
    case 'reorderVariables':
      return t('schemaEditor.titles.reorderVariables');
    case 'addFile':
      return t('schemaEditor.titles.addFile', { path: edit.spec.path });
    case 'updateFile':
      return t('schemaEditor.titles.updateFile', { path: edit.path });
    case 'removeFile':
      return t('schemaEditor.titles.removeFile', { path: edit.path });
  }
}
