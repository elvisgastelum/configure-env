import { TYPE } from '../recipes';
import type { TokenEntry, TYPE_RECIPES } from '../tokens';
import { cn } from '../lib/utils';

import { CopyCode, RichText } from './code';
import { DocTable } from './table';
import { declaredValue } from './theme-values';

const PANGRAM = 'Design that gets out of the way';

/** Font families with a sample in each and the stack it resolves to. */
export function FontFamilies({ entries }: { entries: readonly TokenEntry[] }) {
  return (
    <DocTable
      headers={['Sample', 'Token', 'Stack', 'Used for']}
      rows={entries.map((entry) => {
        const property = /^var\((--[\w-]+)\)$/.exec(entry.value)?.[1];
        return [
          <span
            className="text-2xl font-semibold tracking-tight"
            style={{ fontFamily: entry.value }}
          >
            Aa Gg 123
          </span>,
          <span className="flex flex-col items-start gap-1">
            <span className="font-medium">{entry.name}</span>
            <CopyCode>{entry.value}</CopyCode>
          </span>,
          <span className="font-mono text-xs text-muted-foreground">
            {(property && declaredValue(property)) ?? '—'}
          </span>,
          <span className="text-muted-foreground">
            <RichText>{entry.description}</RichText>
          </span>,
        ];
      })}
    />
  );
}

/**
 * Size, weight or tracking classes, each applied to a sample line. `base`
 * adds the classes every sample shares (a weight for the size scale).
 */
export function TypeScale({
  entries,
  base,
}: {
  entries: readonly TokenEntry[];
  base?: string;
}) {
  return (
    <DocTable
      minWidth="44rem"
      headers={['Sample', 'Class', 'Used for']}
      rows={entries.map((entry) => [
        <span className={cn('block max-w-[28rem] truncate', base, entry.value)}>
          {PANGRAM}
        </span>,
        <CopyCode>{entry.value}</CopyCode>,
        <span className="text-muted-foreground">
          <RichText>{entry.description}</RichText>
        </span>,
      ])}
    />
  );
}

/** Each `TYPE` recipe rendered as it appears, with its class string. */
export function TypeRecipes({ recipes }: { recipes: typeof TYPE_RECIPES }) {
  return (
    <div className="sb-unstyled my-6 flex flex-col divide-y divide-border rounded-xl border border-border bg-card text-card-foreground">
      {recipes.map((entry) => (
        <section key={entry.recipe} className="flex flex-col gap-3 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span className="font-medium">
              {entry.name}{' '}
              <span className="font-mono text-xs text-muted-foreground">
                TYPE.{entry.recipe}
              </span>
            </span>
            <span className="text-xs text-muted-foreground">
              <RichText>{entry.description}</RichText>
            </span>
          </div>
          <p className={TYPE[entry.recipe]}>
            {entry.recipe === 'eyebrow' ? 'Services' : PANGRAM}
          </p>
          <CopyCode>{entry.value}</CopyCode>
        </section>
      ))}
    </div>
  );
}
