import type { Meta, StoryObj } from '@storybook/react-vite';

import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';

/**
 * Switches between panels of related content (Base UI `Tabs`). Arrow keys
 * move between tabs; `variant="line"` underlines the active one.
 */
const meta = {
  title: 'Components/Atoms/Tabs',
  component: Tabs,
  tags: ['autodocs'],
  args: { defaultValue: 'variables', orientation: 'horizontal' },
  argTypes: {
    orientation: {
      control: 'inline-radio',
      options: ['horizontal', 'vertical'],
    },
  },
  render: (args) => (
    <Tabs {...args} className="w-96">
      <TabsList>
        <TabsTrigger value="variables">Variables</TabsTrigger>
        <TabsTrigger value="files">Files</TabsTrigger>
        <TabsTrigger value="history" disabled>
          History
        </TabsTrigger>
      </TabsList>
      <TabsContent value="variables" className="p-2">
        Every variable the schema describes.
      </TabsContent>
      <TabsContent value="files" className="p-2">
        The env files the schema writes.
      </TabsContent>
      <TabsContent value="history" className="p-2">
        Past applies.
      </TabsContent>
    </Tabs>
  ),
} satisfies Meta<typeof Tabs>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Line: Story = {
  render: (args) => (
    <Tabs {...args} className="w-96">
      <TabsList variant="line">
        <TabsTrigger value="variables">Variables</TabsTrigger>
        <TabsTrigger value="files">Files</TabsTrigger>
      </TabsList>
      <TabsContent value="variables" className="p-2">
        Every variable the schema describes.
      </TabsContent>
      <TabsContent value="files" className="p-2">
        The env files the schema writes.
      </TabsContent>
    </Tabs>
  ),
};

export const Vertical: Story = { args: { orientation: 'vertical' } };
