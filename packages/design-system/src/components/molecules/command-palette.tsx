import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';

import { Command, CommandDialog, CommandInput } from '../atoms/command';

type CommandPaletteProps = {
  /** The dialog's accessible name and description (visually hidden). */
  title: string;
  description: string;
  /** Placeholder of the search input. */
  placeholder?: string;
  /** Opens and closes the palette with Mod (⌘ or Ctrl) plus this key. */
  shortcut?: string;
  /** Controlled open state; leave both out to let the palette own it. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** `CommandList` with its groups, items and empty message. */
  children: ReactNode;
};

/**
 * A searchable list of commands in a dialog (cmdk), toggled from anywhere
 * with ⌘K or Ctrl+K. Typing filters the items; Enter runs the highlighted
 * one through its `onSelect`.
 */
function CommandPalette({
  title,
  description,
  placeholder,
  shortcut = 'k',
  open: controlledOpen,
  onOpenChange,
  children,
}: CommandPaletteProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        event.key.toLowerCase() !== shortcut.toLowerCase() ||
        !(event.metaKey || event.ctrlKey)
      ) {
        return;
      }
      event.preventDefault();
      const next = !open;
      setUncontrolledOpen(next);
      onOpenChange?.(next);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, shortcut, onOpenChange]);

  function changeOpen(next: boolean) {
    setUncontrolledOpen(next);
    onOpenChange?.(next);
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={changeOpen}
      title={title}
      description={description}
    >
      <Command>
        <CommandInput placeholder={placeholder} />
        {children}
      </Command>
    </CommandDialog>
  );
}

export { CommandPalette, type CommandPaletteProps };
