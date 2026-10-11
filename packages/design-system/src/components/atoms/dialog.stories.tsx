import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from './button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './dialog';
import { Field, FieldLabel } from './field';
import { Input } from './input';

/**
 * A modal window over the page (Base UI `Dialog`). Focus moves into it and
 * returns to the trigger; Escape or the close button dismisses it.
 */
const meta = {
  title: 'Components/Atoms/Dialog',
  component: Dialog,
  tags: ['autodocs'],
  args: { defaultOpen: false },
  render: (args) => (
    <Dialog {...args}>
      <DialogTrigger render={<Button variant="outline" />}>
        Rename variable
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename variable</DialogTitle>
          <DialogDescription>
            The new name is written to every env file on the next apply.
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="dialog-name">Name</FieldLabel>
          <Input id="dialog-name" defaultValue="API_URL" />
        </Field>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Cancel
          </DialogClose>
          <Button>Rename</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
} satisfies Meta<typeof Dialog>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Rendered open, so the a11y checks cover the dialog itself. */
export const Open: Story = {
  tags: ['!autodocs'],
  args: { defaultOpen: true },
};
