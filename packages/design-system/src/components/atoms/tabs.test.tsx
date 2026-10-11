import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';

function renderTabs(onValueChange = vi.fn()) {
  render(
    <Tabs defaultValue="variables" onValueChange={onValueChange}>
      <TabsList>
        <TabsTrigger value="variables">Variables</TabsTrigger>
        <TabsTrigger value="files">Files</TabsTrigger>
        <TabsTrigger value="history" disabled>
          History
        </TabsTrigger>
      </TabsList>
      <TabsContent value="variables">Variable list</TabsContent>
      <TabsContent value="files">File list</TabsContent>
      <TabsContent value="history">History list</TabsContent>
    </Tabs>,
  );
  return onValueChange;
}

describe('Tabs', () => {
  it('shows the panel of the clicked tab', async () => {
    const user = userEvent.setup();
    const onValueChange = renderTabs();

    await user.click(screen.getByRole('tab', { name: 'Files' }));

    expect(screen.getByRole('tab', { name: 'Files' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tabpanel')).toHaveTextContent('File list');
    expect(onValueChange).toHaveBeenCalledWith('files', expect.anything());
  });

  it('moves between tabs with the arrow keys', async () => {
    const user = userEvent.setup();
    renderTabs();

    await user.tab();
    expect(screen.getByRole('tab', { name: 'Variables' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');

    expect(screen.getByRole('tab', { name: 'Files' })).toHaveFocus();
  });

  it('does not select a disabled tab', async () => {
    const user = userEvent.setup();
    renderTabs();

    await user.click(screen.getByRole('tab', { name: 'History' }));

    expect(screen.getByRole('tabpanel')).toHaveTextContent('Variable list');
  });
});
