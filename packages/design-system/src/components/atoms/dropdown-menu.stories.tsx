import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Button } from './button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './dropdown-menu';

/**
 * A menu of actions or options opened from a button (Base UI `Menu`):
 * items, checkbox and radio items, groups, separators and submenus.
 */
const meta = {
  title: 'Components/Atoms/DropdownMenu',
  component: DropdownMenu,
  tags: ['autodocs'],
  args: { defaultOpen: false },
  render: function Render(args) {
    const [masked, setMasked] = useState(true);
    const [format, setFormat] = useState('dotenv');
    return (
      <DropdownMenu {...args}>
        <DropdownMenuTrigger render={<Button variant="outline" />}>
          Actions
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Variable</DropdownMenuLabel>
            <DropdownMenuItem>
              Duplicate
              <DropdownMenuShortcut>⌘D</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive">
              Delete
              <DropdownMenuShortcut>⌫</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            checked={masked}
            onCheckedChange={setMasked}
          >
            Mask secrets
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Export as</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup value={format} onValueChange={setFormat}>
                <DropdownMenuRadioItem value="dotenv">
                  .env
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="json">JSON</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  },
} satisfies Meta<typeof DropdownMenu>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Rendered open, so the a11y checks cover the menu itself. */
export const Open: Story = {
  tags: ['!autodocs'],
  args: { defaultOpen: true },
};
