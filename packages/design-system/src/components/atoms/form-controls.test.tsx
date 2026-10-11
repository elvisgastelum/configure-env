import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Checkbox } from './checkbox';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from './combobox';
import { Field, FieldDescription, FieldError, FieldLabel } from './field';
import { Input } from './input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './select';
import { Switch } from './switch';

const SHELLS = ['bash', 'fish', 'zsh'];

describe('Switch', () => {
  it('toggles on click and reports the new state', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(
      <Switch aria-label="Mask secrets" onCheckedChange={onCheckedChange} />,
    );
    const toggle = screen.getByRole('switch', { name: 'Mask secrets' });

    await user.click(toggle);

    expect(toggle).toBeChecked();
    expect(onCheckedChange).toHaveBeenCalledWith(true, expect.anything());
  });

  it('ignores clicks while disabled', async () => {
    const user = userEvent.setup();
    render(<Switch aria-label="Mask secrets" disabled />);
    const toggle = screen.getByRole('switch', { name: 'Mask secrets' });

    await user.click(toggle);

    expect(toggle).not.toBeChecked();
  });
});

describe('Checkbox', () => {
  it('checks and unchecks with the keyboard', async () => {
    const user = userEvent.setup();
    render(<Checkbox aria-label="Required" />);
    const box = screen.getByRole('checkbox', { name: 'Required' });

    box.focus();
    await user.keyboard(' ');
    expect(box).toBeChecked();
    await user.keyboard(' ');
    expect(box).not.toBeChecked();
  });
});

describe('Field', () => {
  it('labels its control and shows the error message', () => {
    render(
      <Field data-invalid>
        <FieldLabel htmlFor="api-url">API URL</FieldLabel>
        <Input id="api-url" aria-invalid />
        <FieldDescription>Where the portal sends requests.</FieldDescription>
        <FieldError>Enter a valid URL.</FieldError>
      </Field>,
    );

    expect(screen.getByLabelText('API URL')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid URL.');
  });
});

describe('Select', () => {
  it('picks an option from the popup', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <Select
        items={SHELLS.map((value) => ({ value, label: value }))}
        onValueChange={onValueChange}
      >
        <SelectTrigger aria-label="Shell">
          <SelectValue placeholder="Pick a shell" />
        </SelectTrigger>
        <SelectContent>
          {SHELLS.map((shell) => (
            <SelectItem key={shell} value={shell}>
              {shell}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>,
    );

    await user.click(screen.getByRole('combobox', { name: 'Shell' }));
    await user.click(await screen.findByRole('option', { name: 'zsh' }));

    expect(onValueChange).toHaveBeenCalledWith('zsh', expect.anything());
    expect(screen.getByRole('combobox', { name: 'Shell' })).toHaveTextContent(
      'zsh',
    );
  });
});

describe('Combobox', () => {
  it('filters the options as the user types and picks one', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <Combobox items={SHELLS} onValueChange={onValueChange}>
        <ComboboxInput aria-label="Shell" placeholder="Search shells" />
        <ComboboxContent>
          <ComboboxEmpty>No shell found.</ComboboxEmpty>
          <ComboboxList>
            {(shell: string) => (
              <ComboboxItem key={shell} value={shell}>
                {shell}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>,
    );

    await user.type(screen.getByRole('combobox', { name: 'Shell' }), 'fi');

    expect(await screen.findByRole('option', { name: 'fish' })).toBeVisible();
    expect(screen.queryByRole('option', { name: 'bash' })).toBeNull();

    await user.click(screen.getByRole('option', { name: 'fish' }));
    expect(onValueChange).toHaveBeenCalledWith('fish', expect.anything());
  });

  it('names its icon-only buttons', () => {
    render(
      <Combobox items={SHELLS} defaultValue="fish">
        <ComboboxInput
          aria-label="Shell"
          showClear
          triggerLabel="Open shells"
          clearLabel="Clear shell"
        />
      </Combobox>,
    );

    expect(screen.getByRole('button', { name: 'Open shells' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Clear shell' })).toBeVisible();
  });
});
