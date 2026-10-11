import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from './button';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from './drawer';

/**
 * A panel that slides up from the bottom and can be swiped away (Base UI
 * `Drawer`); the touch-friendly sibling of `Sheet`.
 */
const meta = {
  title: 'Components/Atoms/Drawer',
  component: Drawer,
  tags: ['autodocs'],
  args: { defaultOpen: false },
  render: (args) => (
    <Drawer {...args}>
      <DrawerTrigger render={<Button variant="outline" />}>
        Filters
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Filters</DrawerTitle>
          <DrawerDescription>Narrow the variable list.</DrawerDescription>
        </DrawerHeader>
        <DrawerFooter>
          <Button>Apply filters</Button>
          <DrawerClose render={<Button variant="outline" />}>
            Cancel
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  ),
} satisfies Meta<typeof Drawer>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Rendered open, so the a11y checks cover the panel itself. */
export const Open: Story = {
  tags: ['!autodocs'],
  args: { defaultOpen: true },
};
