import type { Meta, StoryObj } from '@storybook/react-vite';

import { CodeBlock } from './code-block';

/**
 * Monospaced code with a copy button that confirms the copy and announces
 * it to screen readers.
 */
const meta = {
  title: 'Components/Molecules/CodeBlock',
  component: CodeBlock,
  tags: ['autodocs'],
  args: {
    code: 'npx @elvisgastelum/configure-env apply',
    title: 'Terminal',
    language: 'sh',
  },
  render: (args) => (
    <div className="w-[32rem]">
      <CodeBlock {...args} />
    </div>
  ),
} satisfies Meta<typeof CodeBlock>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Untitled: Story = { args: { title: undefined } };

export const MultiLine: Story = {
  args: {
    title: 'env.schema.json',
    language: 'json',
    code: JSON.stringify(
      {
        version: 1,
        variables: { PORT: { type: 'port', default: 8080 } },
      },
      null,
      2,
    ),
  },
};
