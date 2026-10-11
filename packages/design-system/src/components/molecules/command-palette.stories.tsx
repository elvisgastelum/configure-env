import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  FilePlusIcon,
  PlayIcon,
  SearchCheckIcon,
  SettingsIcon,
} from 'lucide-react';
import { useState } from 'react';

import { Button } from '../atoms/button';
import {
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '../atoms/command';
import { Kbd, KbdGroup } from '../atoms/kbd';
import { CommandPalette } from './command-palette';

/**
 * A searchable command list in a dialog (cmdk), toggled with ⌘K or Ctrl+K.
 * Compose it from the `Command*` atoms.
 */
const meta = {
  title: 'Components/Molecules/CommandPalette',
  component: CommandPalette,
  tags: ['autodocs'],
  args: {
    title: 'Command palette',
    description: 'Search for a command to run',
    placeholder: 'Type a command or search…',
    children: null,
  },
  render: function Render(args) {
    const [open, setOpen] = useState(args.open ?? false);
    return (
      <div className="grid justify-items-center gap-3">
        <Button variant="outline" onClick={() => setOpen(true)}>
          Open command palette
        </Button>
        <p className="text-sm text-muted-foreground">
          or press{' '}
          <KbdGroup>
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </KbdGroup>
        </p>
        <CommandPalette {...args} open={open} onOpenChange={setOpen}>
          <CommandList>
            <CommandEmpty>No command found.</CommandEmpty>
            <CommandGroup heading="Variables">
              <CommandItem>
                <FilePlusIcon aria-hidden />
                Add variable
                <CommandShortcut>⌘N</CommandShortcut>
              </CommandItem>
              <CommandItem>
                <PlayIcon aria-hidden />
                Apply env files
              </CommandItem>
              <CommandItem>
                <SearchCheckIcon aria-hidden />
                Check for drift
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading="Portal">
              <CommandItem>
                <SettingsIcon aria-hidden />
                Settings
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </CommandPalette>
      </div>
    );
  },
} satisfies Meta<typeof CommandPalette>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Rendered open, so the a11y checks cover the palette itself. */
export const Open: Story = {
  tags: ['!autodocs'],
  args: { open: true },
};
