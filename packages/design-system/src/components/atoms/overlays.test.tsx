import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vite-plus/test';

import { Button } from './button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from './dialog';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerTitle,
  DrawerTrigger,
} from './drawer';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from './sheet';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './tooltip';

describe('Dialog', () => {
  it('opens from its trigger, closes on Escape and returns focus', async () => {
    const user = userEvent.setup();
    render(
      <Dialog>
        <DialogTrigger render={<Button />}>Delete variable</DialogTrigger>
        <DialogContent>
          <DialogTitle>Delete API_URL?</DialogTitle>
          <DialogDescription>It is removed from every file.</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    const trigger = screen.getByRole('button', { name: 'Delete variable' });

    await user.click(trigger);
    expect(
      await screen.findByRole('dialog', { name: 'Delete API_URL?' }),
    ).toHaveAccessibleDescription('It is removed from every file.');

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it('closes from its labelled close button', async () => {
    const user = userEvent.setup();
    render(
      <Dialog defaultOpen>
        <DialogContent closeLabel="Dismiss">
          <DialogTitle>Details</DialogTitle>
        </DialogContent>
      </Dialog>,
    );

    await user.click(await screen.findByRole('button', { name: 'Dismiss' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('Sheet', () => {
  it('slides in a labelled panel from its trigger', async () => {
    const user = userEvent.setup();
    render(
      <Sheet>
        <SheetTrigger render={<Button />}>Edit</SheetTrigger>
        <SheetContent side="right">
          <SheetTitle>Edit variable</SheetTitle>
        </SheetContent>
      </Sheet>,
    );

    await user.click(screen.getByRole('button', { name: 'Edit' }));

    const sheet = await screen.findByRole('dialog', { name: 'Edit variable' });
    expect(sheet).toHaveAttribute('data-side', 'right');
  });
});

describe('Drawer', () => {
  it('opens and closes from its own buttons', async () => {
    const user = userEvent.setup();
    render(
      <Drawer>
        <DrawerTrigger render={<Button />}>Filters</DrawerTrigger>
        <DrawerContent>
          <DrawerTitle>Filters</DrawerTitle>
          <DrawerClose render={<Button />}>Done</DrawerClose>
        </DrawerContent>
      </Drawer>,
    );

    await user.click(screen.getByRole('button', { name: 'Filters' }));
    expect(
      await screen.findByRole('dialog', { name: 'Filters' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('Popover', () => {
  it('toggles its content from the trigger', async () => {
    const user = userEvent.setup();
    render(
      <Popover>
        <PopoverTrigger render={<Button />}>Info</PopoverTrigger>
        <PopoverContent>Read from .env.example</PopoverContent>
      </Popover>,
    );

    await user.click(screen.getByRole('button', { name: 'Info' }));
    expect(
      await screen.findByText('Read from .env.example'),
    ).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByText('Read from .env.example')).toBeNull(),
    );
  });
});

describe('DropdownMenu', () => {
  it('runs the picked item and closes', async () => {
    const user = userEvent.setup();
    const onDuplicate = vi.fn();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button />}>Actions</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={onDuplicate}>Duplicate</DropdownMenuItem>
          <DropdownMenuItem>Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    await user.click(screen.getByRole('button', { name: 'Actions' }));
    await user.click(
      await screen.findByRole('menuitem', { name: 'Duplicate' }),
    );

    expect(onDuplicate).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('moves between items with the arrow keys', async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button />}>Actions</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Duplicate</DropdownMenuItem>
          <DropdownMenuItem>Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    screen.getByRole('button', { name: 'Actions' }).focus();
    await user.keyboard('{ArrowDown}');
    await screen.findByRole('menu');
    await user.keyboard('{ArrowDown}');

    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus(),
    );
  });
});

describe('Tooltip', () => {
  it('shows its content while the trigger has focus', async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger render={<Button />}>Copy</TooltipTrigger>
          <TooltipContent>Copy to clipboard</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );

    await user.tab();

    expect(await screen.findByText('Copy to clipboard')).toBeInTheDocument();
  });
});
