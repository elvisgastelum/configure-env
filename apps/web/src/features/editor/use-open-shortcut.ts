// The `o` shortcut, on every page: it presses the Open in editor button of
// the item that holds the focus, else of the selected item (a variables
// table row), else, in an open drawer or dialog, its first one. It stays out
// of the way of typing, modified keys and open menus.

import { useEffect } from 'react';
import { EDITOR_BUTTON, EDITOR_ITEM, OPEN_SHORTCUT } from './editor';

const TYPING =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"]';
const MENU = '[role="menu"], [role="listbox"]';
const DIALOG = '[role="dialog"], [role="alertdialog"]';
const BUTTON = `[${EDITOR_BUTTON}]:not(:disabled)`;
const ITEM = `[${EDITOR_ITEM}]`;

/** The button `o` presses now, if any. */
function buttonToPress(): HTMLElement | null {
  const active = document.activeElement;
  if (active && active !== document.body) {
    if (active.matches(BUTTON)) return active as HTMLElement;
    const item = active.closest(ITEM);
    if (item) return item.querySelector<HTMLElement>(BUTTON);
  }
  const dialogs = document.querySelectorAll(DIALOG);
  const dialog = dialogs[dialogs.length - 1];
  if (dialog) return dialog.querySelector<HTMLElement>(BUTTON);
  return document.querySelector<HTMLElement>(
    `${ITEM}[aria-selected="true"] ${BUTTON}`,
  );
}

export function useOpenShortcut() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== OPEN_SHORTCUT) return;
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return;
      const target = event.target as Element | null;
      if (target?.closest?.(TYPING)) return;
      if (document.querySelector(MENU)) return;
      const button = buttonToPress();
      if (!button) return;
      event.preventDefault();
      button.click();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
