import type { Meta, StoryObj } from '@storybook/react-vite';

import { PageGlow } from './page-glow';
import { CONTAINER, TYPE } from '../../recipes';
import { cn } from '../../lib/utils';

/**
 * The soft brand glows behind a page's heading (and, from `md`, one at the
 * bottom right). Decorative; its parent must be `relative isolate`.
 */
const meta = {
  title: 'Components/Atoms/PageGlow',
  component: PageGlow,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  render: () => (
    <div className="relative isolate min-h-[36rem] overflow-hidden">
      <PageGlow />
      <div className={cn(CONTAINER, 'flex flex-col gap-3 pt-16')}>
        <p className={TYPE.eyebrow}>Contact</p>
        <h1 className={TYPE.pageTitle}>Let&apos;s build it together</h1>
        <p className={TYPE.lead}>
          The glow sits behind the heading and fades into the page.
        </p>
      </div>
    </div>
  ),
} satisfies Meta<typeof PageGlow>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
