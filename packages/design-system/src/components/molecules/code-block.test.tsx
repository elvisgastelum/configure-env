import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CodeBlock } from './code-block';

const CODE = 'npx @elvisgastelum/configure-env apply';

describe('CodeBlock', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the code with its title', () => {
    render(<CodeBlock code={CODE} title="Terminal" language="sh" />);

    expect(screen.getByText(CODE)).toBeInTheDocument();
    expect(screen.getByText('Terminal')).toBeInTheDocument();
    expect(screen.getByText(CODE).closest('pre')).toHaveAttribute(
      'data-language',
      'sh',
    );
  });

  it('copies the code to the clipboard and confirms it', async () => {
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue();
    render(
      <CodeBlock code={CODE} copyLabel="Copy command" copiedLabel="Copied!" />,
    );

    await user.click(screen.getByRole('button', { name: 'Copy command' }));

    expect(writeText).toHaveBeenCalledWith(CODE);
    expect(
      await screen.findByRole('button', { name: 'Copied!' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Copied!');
  });

  it('goes back to the copy label after a moment', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    render(<CodeBlock code={CODE} />);

    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(
      await screen.findByRole('button', { name: 'Copied' }),
    ).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  });

  it('keeps the copy label when the clipboard refuses', async () => {
    const user = userEvent.setup();
    const onCopyError = vi.fn();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(
      new Error('denied'),
    );
    render(<CodeBlock code={CODE} onCopyError={onCopyError} />);

    await user.click(screen.getByRole('button', { name: 'Copy' }));

    await vi.waitFor(() => expect(onCopyError).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  });
});
