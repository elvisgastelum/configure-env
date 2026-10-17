// `configure-env history`: the latest changes the CLI and the portal made,
// from the state database's history of edits. Values are previews: a
// secret's is masked, and no value is ever stored for it. Undo stays in the
// portal. It runs through the configure-env API (connect.ts): GET
// /api/history.

import { type Change, getHistory } from '@configure-env/api-client/client';
import { CliError, displayPath, parseCommand, usageError } from './common.ts';
import { answerMessage, openTarget, send } from './connect.ts';
import { HISTORY_HELP } from './help.ts';
import { table } from './inspect.ts';
import type { Io } from './io.ts';

/** How many changes history lists, newest first. */
export const HISTORY_LIMIT = 20;

const MAX_PREVIEW = 30;

const cut = (text: string) => {
  const chars = [...text];
  return chars.length > MAX_PREVIEW
    ? `${chars.slice(0, MAX_PREVIEW - 1).join('')}…`
    : text;
};

/** A change as `--json` prints it: previews only, never a fingerprint. */
function changeJson(change: Change) {
  const blocker = change.undoBlocker;
  return {
    id: change.id,
    at: change.at,
    actor: change.actor,
    file: change.file,
    key: change.key,
    operation: change.operation,
    before: change.beforePreview,
    after: change.afterPreview,
    restorable: change.restorable,
    ...(blocker ? { undoBlocker: blocker } : {}),
    undoOf: change.undoOf,
  };
}

/** The WHEN column: the UTC date and minute. */
const when = (at: string) => `${at.slice(0, 10)} ${at.slice(11, 16)}`;

export async function historyCommand(args: string[], io: Io): Promise<number> {
  const options = parseCommand(args, {});
  if (options.help) {
    io.stdout(HISTORY_HELP);
    return 0;
  }
  if (options.file?.length) throw usageError('history takes no --file');
  const run = await openTarget(io, options);
  const connection = await run.connect();
  let response: Awaited<ReturnType<typeof getHistory>>;
  try {
    response = await send(connection, () =>
      getHistory({ limit: HISTORY_LIMIT }, connection.init()),
    );
  } finally {
    await connection.close();
  }
  if (response.status !== 200) {
    const message = answerMessage(response);
    const { statePath } = run;
    throw new CliError(1, [
      statePath
        ? message.replaceAll(statePath, displayPath(io.cwd, statePath))
        : message,
    ]);
  }
  const page = response.data;

  if (run.json) {
    io.stdout(
      JSON.stringify({
        command: 'history',
        ok: true,
        total: page.total,
        changes: page.changes.map(changeJson),
      }),
    );
    return 0;
  }
  if (!page.changes.length) {
    io.stdout('No changes recorded yet.');
    return 0;
  }
  table([
    ['ID', 'WHEN (UTC)', 'BY', 'CHANGE', 'FILE', 'KEY', 'BEFORE', 'AFTER'],
    ...page.changes.map((change) => [
      String(change.id),
      when(change.at),
      change.actor,
      change.undoOf === null
        ? change.operation
        : `${change.operation} (undid ${change.undoOf})`,
      change.file,
      change.key || '-',
      cut(change.beforePreview ?? '-'),
      cut(change.afterPreview ?? '-'),
    ]),
  ]).forEach((line) => io.stdout(line));
  if (page.total > page.changes.length)
    io.stdout(
      `The ${page.changes.length} latest of ${page.total} changes; undo one in the portal (configure-env serve).`,
    );
  return 0;
}
