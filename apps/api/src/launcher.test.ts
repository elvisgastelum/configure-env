// The launch-editor adapter, with launch-editor replaced: no editor starts.

import { beforeEach, describe, expect, it, vi } from 'vitest';

type OnError = (file: string, message: string | null) => void;
const calls: unknown[][] = [];
let behave: (onError: OnError) => void = () => {};

vi.mock('launch-editor', () => ({
  default: (...args: unknown[]) => {
    calls.push(args);
    behave(args.at(-1) as OnError);
  },
}));

const { NO_EDITOR_MESSAGE, createLauncher, editorCommand } =
  await import('./editor.ts');

const target = { file: '/project/.env', line: 4, column: 2 };

beforeEach(() => {
  calls.length = 0;
  behave = () => {};
});

describe('editorCommand', () => {
  it('leaves $LAUNCH_EDITOR to launch-editor, then takes $VISUAL, then $EDITOR', () => {
    expect(
      editorCommand({ LAUNCH_EDITOR: 'zed', VISUAL: 'code', EDITOR: 'vim' }),
    ).toBeUndefined();
    expect(editorCommand({ VISUAL: 'code -w', EDITOR: 'vim' })).toBe('code -w');
    expect(editorCommand({ VISUAL: '', EDITOR: 'vim' })).toBe('vim');
    expect(editorCommand({})).toBeUndefined();
  });
});

describe('createLauncher', () => {
  it('passes the file with its line and column, and $VISUAL as the editor', async () => {
    const result = await createLauncher({ VISUAL: 'cursor' }, 'darwin')(target);
    expect(result).toEqual({ opened: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.slice(0, 2)).toEqual(['/project/.env:4:2', 'cursor']);
  });

  it('lets launch-editor detect the editor when none is set', async () => {
    await createLauncher({}, 'linux')(target);
    expect(calls[0]).toHaveLength(2);
    expect(calls[0]![0]).toBe('/project/.env:4:2');
  });

  it('answers no-editor when launch-editor finds none', async () => {
    behave = (onError) => onError('/project/.env', null);
    const result = await createLauncher({}, 'darwin')(target);
    expect(result).toEqual({
      opened: false,
      reason: 'no-editor',
      message: NO_EDITOR_MESSAGE,
    });
  });

  it('answers failed when the editor command fails at once', async () => {
    behave = (onError) =>
      setTimeout(() => onError('/project/.env', 'spawn nope ENOENT'), 10);
    const result = await createLauncher({ EDITOR: 'nope' }, 'darwin')(target);
    expect(result).toEqual({
      opened: false,
      reason: 'failed',
      message: 'the editor could not open the file: spawn nope ENOENT',
    });
  });

  it('never passes a name cmd.exe would expand on Windows', async () => {
    const result = await createLauncher(
      {},
      'win32',
    )({
      ...target,
      file: 'C:\\project\\%PATH%.env',
    });
    expect(result).toMatchObject({ opened: false, reason: 'failed' });
    expect(calls).toEqual([]);
  });
});
