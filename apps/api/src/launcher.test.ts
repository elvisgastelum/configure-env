// The launcher over launch-editor's guess, with the guess and the spawn
// replaced: no editor starts, and nothing reads this machine's processes.

import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const guesses: (string | undefined)[] = [];
let guessed: (string | null)[] = ['code'];
vi.mock('launch-editor/guess.js', () => ({
  default: (specified?: string) => {
    guesses.push(specified);
    return guessed;
  },
}));

/** A child process that does what the test says, when it says. */
class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  unref = vi.fn();
}
const spawned: { command: string; args: string[]; options: unknown }[] = [];
let child = new FakeChild();
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  spawn: (command: string, args: string[], options: unknown) => {
    spawned.push({ command, args, options });
    return child;
  },
}));

const { NO_EDITOR_MESSAGE, createLauncher } = await import('./editor.ts');

const target = { file: '/project/.env', line: 4, column: 2 };

/** What the launcher writes to its log. */
function logged() {
  const log = new PassThrough();
  let text = '';
  log.on('data', (chunk: Buffer) => (text += chunk));
  return { log, text: () => text };
}

beforeEach(() => {
  guesses.length = 0;
  spawned.length = 0;
  guessed = ['code'];
  child = new FakeChild();
});

describe('createLauncher', () => {
  it('leaves the order to the guess: $LAUNCH_EDITOR, a running IDE, $VISUAL, $EDITOR', async () => {
    vi.stubEnv('VISUAL', 'vim');
    vi.stubEnv('EDITOR', 'nano');
    const opening = createLauncher('darwin', logged().log)(target);
    child.emit('exit', 0);
    await opening;
    // No editor of its own: launch-editor's guess tries a running IDE
    // before $VISUAL and $EDITOR.
    expect(guesses).toEqual([undefined]);
    vi.unstubAllEnvs();
  });

  it("spawns the guessed editor without a shell at the file's line and column", async () => {
    const { log } = logged();
    const opening = createLauncher('darwin', log)(target);
    child.emit('exit', 0);
    expect(await opening).toEqual({ opened: true });
    expect(spawned).toEqual([
      {
        command: 'code',
        args: ['-r', '-g', '/project/.env:4:2'],
        options: { stdio: ['ignore', 'pipe', 'pipe'] },
      },
    ]);
    expect(child.unref).toHaveBeenCalled();
  });

  it('counts a launch still running after a moment as opened', async () => {
    const opening = createLauncher('linux', logged().log)(target);
    expect(await opening).toEqual({ opened: true });
  });

  it('answers no-editor when the guess finds none, and spawns nothing', async () => {
    guessed = [null];
    const result = await createLauncher('darwin', logged().log)(target);
    expect(result).toEqual({
      opened: false,
      reason: 'no-editor',
      message: NO_EDITOR_MESSAGE,
    });
    expect(spawned).toEqual([]);
  });

  it('answers failed when the editor command does not exist', async () => {
    guessed = ['nope'];
    const opening = createLauncher('darwin', logged().log)(target);
    child.emit(
      'error',
      Object.assign(new Error('spawn nope ENOENT'), { code: 'ENOENT' }),
    );
    expect(await opening).toEqual({
      opened: false,
      reason: 'failed',
      message:
        "the editor could not open the file: spawn nope ENOENT ('nope' is not a command on the PATH)",
    });
  });

  it('answers failed when the editor exits with an error at once', async () => {
    const opening = createLauncher('darwin', logged().log)(target);
    child.emit('exit', 3);
    expect(await opening).toEqual({
      opened: false,
      reason: 'failed',
      message:
        'the editor could not open the file: the editor exited with code 3',
    });
  });

  it('sends what the editor prints, and a late failure, to the log, never to stdout', async () => {
    const { log, text } = logged();
    const stdout = vi.spyOn(process.stdout, 'write');
    const opening = createLauncher('darwin', log)(target);
    child.stdout.write('hello from the editor\n');
    child.stderr.write('a warning\n');
    expect(await opening).toEqual({ opened: true });
    child.emit('exit', 1);
    await new Promise((resolve) => setImmediate(resolve));
    expect(text()).toBe(
      'hello from the editor\na warning\nconfigure-env: the editor exited with code 1\n',
    );
    expect(stdout).not.toHaveBeenCalled();
  });

  it('never passes a name cmd.exe would expand on Windows', async () => {
    for (const file of ['C:\\project\\%PATH%.env', '\\\\server\\share\\.env']) {
      const result = await createLauncher(
        'win32',
        logged().log,
      )({
        ...target,
        file,
      });
      expect(result).toMatchObject({ opened: false, reason: 'failed' });
    }
    expect(guesses).toEqual([]);
    expect(spawned).toEqual([]);
  });
});
