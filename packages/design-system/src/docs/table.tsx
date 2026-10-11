import type { ReactNode } from 'react';

import type { TokenEntry } from '../tokens';

import { CopyCode, RichText } from './code';

/**
 * A docs table that scrolls sideways inside its own frame on narrow
 * screens, so the page itself never does.
 */
export function DocTable({
  headers,
  rows,
  minWidth = '40rem',
}: {
  headers: readonly string[];
  /** Plain-text cells may mark inline code with backticks. */
  rows: readonly (readonly ReactNode[])[];
  /** Below this width the table scrolls instead of squeezing. */
  minWidth?: string;
}) {
  return (
    <div className="sb-unstyled my-6 overflow-x-auto rounded-xl border border-border bg-card text-card-foreground">
      <table
        className="w-full border-collapse text-left text-sm"
        style={{ minWidth }}
      >
        <thead className="bg-muted/60 text-xs tracking-wide text-muted-foreground uppercase">
          <tr>
            {headers.map((header) => (
              <th key={header} scope="col" className="px-4 py-3 font-semibold">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((cells, row) => (
            <tr key={row} className="align-top">
              {cells.map((cell, column) => (
                <td key={column} className="px-4 py-3">
                  {typeof cell === 'string' ? (
                    <RichText>{cell}</RichText>
                  ) : (
                    cell
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Catalog entries as rows: an optional live preview, name, value, purpose. */
export function TokenTable({
  entries,
  preview,
  minWidth,
}: {
  entries: readonly TokenEntry[];
  preview?: (entry: TokenEntry) => ReactNode;
  minWidth?: string;
}) {
  const headers = ['Token', 'Value', 'Used for'];
  return (
    <DocTable
      minWidth={minWidth}
      headers={preview ? ['Preview', ...headers] : headers}
      rows={entries.map((entry) => {
        const cells = [
          <span className="font-medium whitespace-nowrap">{entry.name}</span>,
          <CopyCode>{entry.value}</CopyCode>,
          <span className="text-muted-foreground">
            <RichText>{entry.description}</RichText>
          </span>,
        ];
        return preview ? [preview(entry), ...cells] : cells;
      })}
    />
  );
}
