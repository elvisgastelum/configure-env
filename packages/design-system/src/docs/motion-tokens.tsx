import {
  DURATION,
  REVEAL_DISTANCE,
  REVEAL_VIEWPORT,
  SLIDE_IN_DISTANCE,
  SLIDE_IN_OFFSET,
  SLIDE_IN_OPACITY,
  SPRINGS,
  STAGGER,
  WORD_STAGGER,
} from '../tokens';

import { Code, RichText } from './code';
import { DocTable } from './table';

/** The JavaScript motion tokens (`motion/tokens.ts`). */
const MOTION_ROWS: readonly [name: string, value: string, use: string][] = [
  ['DURATION.fast', `${DURATION.fast}s`, 'Page entrance, active indicator.'],
  ['DURATION.base', `${DURATION.base}s`, 'Every reveal.'],
  ['DURATION.slow', `${DURATION.slow}s`, 'Each word of a masked headline.'],
  ['STAGGER', `${STAGGER}s`, 'The pause between items of a reveal group.'],
  ['WORD_STAGGER', `${WORD_STAGGER}s`, 'The pause between masked words.'],
  ['REVEAL_DISTANCE', `${REVEAL_DISTANCE}px`, 'How far a reveal travels in.'],
  [
    'REVEAL_VIEWPORT',
    JSON.stringify(REVEAL_VIEWPORT),
    'When a reveal starts: once, as any part clears the bottom 10%.',
  ],
  [
    'SLIDE_IN_DISTANCE',
    `${SLIDE_IN_DISTANCE}px`,
    'How far a paired card starts towards its side.',
  ],
  [
    'SLIDE_IN_OPACITY',
    String(SLIDE_IN_OPACITY),
    'How faint a paired card starts.',
  ],
  [
    'SLIDE_IN_OFFSET',
    JSON.stringify(SLIDE_IN_OFFSET),
    'The scroll range of a slide-in, against the card.',
  ],
];

/** The motion tokens as a table: name, value, and what uses it. */
export function MotionTokenTable() {
  return (
    <DocTable
      headers={['Token', 'Value', 'Used for']}
      rows={MOTION_ROWS.map(([name, value, use]) => [
        <Code>{name}</Code>,
        <span className="font-mono text-xs break-all">{value}</span>,
        <span className="text-muted-foreground">
          <RichText>{use}</RichText>
        </span>,
      ])}
    />
  );
}

/** The springs motion components use, and where. */
export function SpringTable() {
  return (
    <DocTable
      minWidth="44rem"
      headers={['Spring', 'Settings', 'Source', 'Used for']}
      rows={SPRINGS.map((spring) => [
        <span className="font-medium whitespace-nowrap">{spring.name}</span>,
        <span className="font-mono text-xs">{spring.value}</span>,
        <Code>{spring.source}</Code>,
        <span className="text-muted-foreground">
          <RichText>{spring.description}</RichText>
        </span>,
      ])}
    />
  );
}
