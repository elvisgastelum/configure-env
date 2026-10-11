import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { NumberInput } from './number-input';

describe('NumberInput', () => {
  it('steps the value with its buttons and reports each change', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <NumberInput
        aria-label="Port"
        defaultValue={8080}
        onValueChange={onValueChange}
        incrementLabel="Increase port"
        decrementLabel="Decrease port"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Increase port' }));
    expect(screen.getByRole('textbox', { name: 'Port' })).toHaveValue('8,081');
    await user.click(screen.getByRole('button', { name: 'Decrease port' }));
    await user.click(screen.getByRole('button', { name: 'Decrease port' }));

    expect(screen.getByRole('textbox', { name: 'Port' })).toHaveValue('8,079');
    expect(onValueChange).toHaveBeenLastCalledWith(8079, expect.anything());
  });

  it('keeps a typed value within min and max', async () => {
    const user = userEvent.setup();
    render(<NumberInput aria-label="Retries" min={0} max={5} />);
    const input = screen.getByRole('textbox', { name: 'Retries' });

    await user.type(input, '12');
    await user.tab();

    expect(input).toHaveValue('5');
  });

  it('disables the decrement button at the minimum', () => {
    render(
      <NumberInput
        aria-label="Workers"
        min={1}
        defaultValue={1}
        decrementLabel="Fewer workers"
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Fewer workers' }),
    ).toBeDisabled();
  });
});
