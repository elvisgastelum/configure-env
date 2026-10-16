import type { TFunction } from 'i18next';
import type { SchemaEdit } from './edits';
import type { VariableField } from './variable-model';

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

/** The label a variable form field shows, for the type switch's list. */
export function fieldLabel(t: TFunction, field: VariableField): string {
  switch (field) {
    case 'default':
    case 'example':
      return t(`schemaEditor.variableForm.${field}`);
    case 'minLength':
    case 'maxLength':
    case 'pattern':
    case 'patternMessage':
    case 'encoding':
    case 'bytes':
    case 'min':
    case 'max':
    case 'values':
    case 'protocols':
    case 'within':
    case 'family':
    case 'strict':
      return t(`schemaEditor.typeOptions.${field}`);
    default:
      return field;
  }
}
