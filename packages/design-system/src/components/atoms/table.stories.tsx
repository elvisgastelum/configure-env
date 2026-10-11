import type { Meta, StoryObj } from '@storybook/react-vite';

import { Badge } from './badge';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from './table';

const ROWS = [
  { name: 'API_URL', type: 'url', file: '.env', required: true },
  { name: 'LOG_LEVEL', type: 'enum', file: '.env', required: false },
  { name: 'PORT', type: 'port', file: '.env.local', required: true },
  {
    name: 'SESSION_SECRET',
    type: 'secret',
    file: '.env.local',
    required: true,
  },
];

/** Semantic table markup with the system's borders, hover and spacing. */
const meta = {
  title: 'Components/Atoms/Table',
  component: Table,
  tags: ['autodocs'],
  render: () => (
    <div className="w-[36rem]">
      <Table>
        <TableCaption>Variables in env.schema.json.</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>File</TableHead>
            <TableHead className="text-right">Required</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ROWS.map((row) => (
            <TableRow key={row.name}>
              <TableCell className="font-mono">{row.name}</TableCell>
              <TableCell>
                <Badge variant="secondary">{row.type}</Badge>
              </TableCell>
              <TableCell className="font-mono">{row.file}</TableCell>
              <TableCell className="text-right">
                {row.required ? 'Yes' : 'No'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={3}>Total</TableCell>
            <TableCell className="text-right">{ROWS.length}</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  ),
} satisfies Meta<typeof Table>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
