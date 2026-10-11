import type { Meta, StoryObj } from '@storybook/react-vite';
import { FileQuestionIcon, PlusIcon } from 'lucide-react';

import { Button } from './button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from './empty';

/**
 * The empty state of a list or page: an icon, a title, a short
 * explanation and the action that fills it.
 */
const meta = {
  title: 'Components/Atoms/Empty',
  component: Empty,
  tags: ['autodocs'],
  render: () => (
    <Empty className="w-[28rem] border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FileQuestionIcon aria-hidden />
        </EmptyMedia>
        <EmptyTitle>No variables yet</EmptyTitle>
        <EmptyDescription>
          Add a variable to the schema, or start one from .env.example.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button>
          <PlusIcon aria-hidden />
          Add variable
        </Button>
      </EmptyContent>
    </Empty>
  ),
} satisfies Meta<typeof Empty>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
