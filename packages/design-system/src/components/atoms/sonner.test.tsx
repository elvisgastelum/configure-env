import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vite-plus/test';

import { setThemePreference } from '../../theme/theme';
import { Button } from './button';
import { Toaster, toast } from './sonner';

describe('Toaster', () => {
  // Sonner reads the system color scheme; jsdom has no matchMedia.
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows a toast with its description and runs its action', async () => {
    const user = userEvent.setup();
    let undone = false;
    render(
      <>
        <Toaster />
        <Button
          onClick={() =>
            toast.success('Variable saved', {
              description: 'API_URL was written to .env',
              action: { label: 'Undo', onClick: () => (undone = true) },
            })
          }
        >
          Save
        </Button>
      </>,
    );

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Variable saved')).toBeInTheDocument();
    expect(screen.getByText('API_URL was written to .env')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(undone).toBe(true);
  });

  it('follows the theme preference', async () => {
    render(<Toaster />);
    act(() => {
      setThemePreference('dark');
      toast('Hello');
    });

    const toaster = (await screen.findByText('Hello')).closest(
      '[data-sonner-toaster]',
    );
    expect(toaster).toHaveAttribute('data-sonner-theme', 'dark');
  });
});
