import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '../atoms/command';
import { CommandPalette } from './command-palette';

function renderPalette(onSelect = vi.fn()) {
  render(
    <CommandPalette
      title="Command palette"
      description="Run a command"
      placeholder="Type a command"
    >
      <CommandList>
        <CommandEmpty>No command found.</CommandEmpty>
        <CommandGroup heading="Variables">
          <CommandItem onSelect={() => onSelect('add')}>
            Add variable
          </CommandItem>
          <CommandItem onSelect={() => onSelect('apply')}>
            Apply files
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandPalette>,
  );
  return onSelect;
}

describe('CommandPalette', () => {
  it('opens with Mod+K and closes with Escape', async () => {
    const user = userEvent.setup();
    renderPalette();
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.keyboard('{Control>}k{/Control}');
    expect(
      await screen.findByRole('dialog', { name: 'Command palette' }),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Type a command')).toHaveFocus();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('also opens with Meta+K', async () => {
    const user = userEvent.setup();
    renderPalette();

    await user.keyboard('{Meta>}k{/Meta}');

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('filters the commands and runs the chosen one', async () => {
    const user = userEvent.setup();
    const onSelect = renderPalette();

    await user.keyboard('{Control>}k{/Control}');
    await user.type(
      await screen.findByPlaceholderText('Type a command'),
      'appl',
    );

    expect(screen.queryByRole('option', { name: 'Add variable' })).toBeNull();
    await user.keyboard('{Enter}');

    expect(onSelect).toHaveBeenCalledWith('apply');
  });

  it('shows the empty message when nothing matches', async () => {
    const user = userEvent.setup();
    renderPalette();

    await user.keyboard('{Control>}k{/Control}');
    await user.type(
      await screen.findByPlaceholderText('Type a command'),
      'zzz',
    );

    expect(screen.getByText('No command found.')).toBeInTheDocument();
  });
});
