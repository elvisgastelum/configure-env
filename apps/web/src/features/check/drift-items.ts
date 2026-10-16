// The check report as the page lists it: one item per problem in a file,
// value problems first (each fixed by setting the value), then the file's
// own (fixed by applying it).

import type { FileDrift, OpenInEditorRequest } from '@configure-env/api-client';

export type DriftItem =
  | { kind: 'absent' }
  | { kind: 'differs' }
  | { kind: 'refused'; message: string }
  | { kind: 'missing'; key: string }
  | { kind: 'invalid'; key: string; message: string; shown: string }
  | { kind: 'rule'; key: string; message: string }
  | { kind: 'protected'; key: string; message: string; reason?: string }
  | { kind: 'unknown'; key: string }
  | { kind: 'mode'; actual: string; expected: string }
  | { kind: 'line'; line: number };

/** The items of one file's report, in the order the page lists them. */
export function driftItems(file: FileDrift): DriftItem[] {
  const items: DriftItem[] = [];
  if (file.error) items.push({ kind: 'refused', message: file.error });
  if (file.status === 'missing') items.push({ kind: 'absent' });
  if (file.status === 'differs') items.push({ kind: 'differs' });
  for (const key of file.missingKeys) items.push({ kind: 'missing', key });
  for (const { key, message, shown } of file.invalid)
    items.push({ kind: 'invalid', key, message, shown });
  for (const { key, message } of file.rules)
    items.push({ kind: 'rule', key, message });
  for (const { key, message, reason } of file.protected)
    items.push({
      kind: 'protected',
      key,
      message,
      ...(reason ? { reason } : {}),
    });
  for (const key of file.unknownKeys) items.push({ kind: 'unknown', key });
  if (file.mode) items.push({ kind: 'mode', ...file.mode });
  for (const line of file.invalidLines) items.push({ kind: 'line', line });
  return items;
}

/** Whether applying the file fixes some of its items. */
export const applyFixes = (file: FileDrift) =>
  file.status !== 'current' && file.status !== 'refused'
    ? true
    : file.mode !== undefined;

/** The key an item is about, which setting its value fixes. */
export const keyOf = (item: DriftItem) =>
  item.kind === 'missing' ||
  item.kind === 'invalid' ||
  item.kind === 'rule' ||
  item.kind === 'protected'
    ? item.key
    : undefined;

/**
 * Where an item opens in the editor: a key at its entry, a bad line at its
 * line, the file's own problems at its top. Nothing for a file that does not
 * exist or whose path is refused.
 */
export function editorTargetOf(
  file: FileDrift,
  item: DriftItem,
): OpenInEditorRequest | undefined {
  if (file.status === 'missing' || file.status === 'refused') return undefined;
  switch (item.kind) {
    case 'absent':
    case 'refused':
      return undefined;
    case 'line':
      return { file: file.path, line: item.line };
    case 'differs':
    case 'mode':
      return { file: file.path };
    default:
      return { file: file.path, key: item.key };
  }
}
