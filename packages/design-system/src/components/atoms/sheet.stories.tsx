import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from './button';
import { Field, FieldLabel } from './field';
import { Input } from './input';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from './sheet';

const SIDES = ['top', 'right', 'bottom', 'left'] as const;

/** A modal panel that slides in from an edge of the screen. */
const meta = {
  title: 'Components/Atoms/Sheet',
  component: Sheet,
  tags: ['autodocs'],
  args: { defaultOpen: false },
  render: (args) => (
    <Sheet {...args}>
      <SheetTrigger render={<Button variant="outline" />}>
        Edit variable
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Edit variable</SheetTitle>
          <SheetDescription>Changes apply on save.</SheetDescription>
        </SheetHeader>
        <Field className="px-4">
          <FieldLabel htmlFor="sheet-value">Value</FieldLabel>
          <Input id="sheet-value" defaultValue="https://api.example.com" />
        </Field>
        <SheetFooter>
          <Button>Save</Button>
          <SheetClose render={<Button variant="outline" />}>Cancel</SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  ),
} satisfies Meta<typeof Sheet>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** `side` picks the edge it slides in from. */
export const Sides: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      {SIDES.map((side) => (
        <Sheet key={side}>
          <SheetTrigger render={<Button variant="outline" />}>
            {side}
          </SheetTrigger>
          <SheetContent side={side}>
            <SheetHeader>
              <SheetTitle>From the {side}</SheetTitle>
              <SheetDescription>A sheet on the {side} edge.</SheetDescription>
            </SheetHeader>
          </SheetContent>
        </Sheet>
      ))}
    </div>
  ),
};

/** Rendered open, so the a11y checks cover the panel itself. */
export const Open: Story = {
  tags: ['!autodocs'],
  args: { defaultOpen: true },
};
