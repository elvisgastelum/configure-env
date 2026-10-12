// The variables page's single-key shortcuts: `/` focuses the search, `j`
// and `k` move between rows, `c` copies the selected value, `e` edits it.
// They stay out of the way of typing, modified keys, dialogs and menus.

import { useEffect, useRef } from 'react';

export interface Shortcuts {
  search: () => void;
  move: (delta: 1 | -1) => void;
  copy: () => void;
  edit: () => void;
}

const TYPING =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"]';
const OVERLAY =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/** Whether a key press belongs to something else: typing, or an overlay. */
function belongsElsewhere(event: KeyboardEvent) {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey)
    return true;
  const target = event.target as Element | null;
  if (target?.closest?.(TYPING)) return true;
  return document.querySelector(OVERLAY) !== null;
}

export function useShortcuts(shortcuts: Shortcuts) {
  // The latest handlers, without re-binding the listener on every render.
  const current = useRef(shortcuts);
  useEffect(() => {
    current.current = shortcuts;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (belongsElsewhere(event)) return;
      const actions: Record<string, () => void> = {
        '/': current.current.search,
        j: () => current.current.move(1),
        k: () => current.current.move(-1),
        c: current.current.copy,
        e: current.current.edit,
      };
      const action = actions[event.key];
      if (!action) return;
      event.preventDefault();
      action();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
