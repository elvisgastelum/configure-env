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
const execed: unknown[][] = [];
let child = new FakeChild();
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  spawn: (command: string, args: string[], options: unknown) => {
    spawned.push({ command, args, options });
    return child;
  },
  exec: (...args: unknown[]) => {
    execed.push(args);
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
  execed.length = 0;
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

  it('leaves no listener on the log, however many editors keep running', async () => {
    const { log } = logged();
    const listeners = () =>
      log.eventNames().reduce((sum, name) => sum + log.listenerCount(name), 0);
    const before = listeners();
    const warnings: Error[] = [];
    const onWarning = (warning: Error) => warnings.push(warning);
    process.on('warning', onWarning);
    const launch = createLauncher('darwin', log);
    const children: FakeChild[] = [];
    for (let i = 0; i < 12; i++) {
      child = new FakeChild();
      children.push(child);
      expect(await launch(target)).toEqual({ opened: true });
    }
    expect(listeners()).toBe(before);
    for (const running of children) {
      running.stdout.end();
      running.stderr.end();
      running.emit('exit', 0);
    }
    await new Promise((resolve) => setImmediate(resolve));
    process.off('warning', onWarning);
    expect(listeners()).toBe(before);
    expect(
      warnings.filter((w) => w.name === 'MaxListenersExceededWarning'),
    ).toEqual([]);
  });

  it('runs the editor through cmd.exe with spawn on Windows, never exec, and logs its output', async () => {
    vi.stubEnv('ComSpec', 'C:\\Windows\\System32\\cmd.exe');
    const { log, text } = logged();
    // get-args resolves the path on the host, so a POSIX one here.
    const file = '/my project/.env';
    const opening = createLauncher('win32', log)({ ...target, file });
    child.stdout.write('hello from the editor\n');
    expect(await opening).toEqual({ opened: true });
    vi.unstubAllEnvs();
    expect(execed).toEqual([]);
    expect(spawned).toEqual([
      {
        command: 'C:\\Windows\\System32\\cmd.exe',
        args: ['/d', '/s', '/c', '"code -r -g "/my project/.env:4:2""'],
        options: {
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
          windowsVerbatimArguments: true,
        },
      },
    ]);
    expect(text()).toBe('hello from the editor\n');
  });

  it('falls back to cmd.exe when ComSpec is not set', async () => {
    vi.stubEnv('ComSpec', undefined);
    const opening = createLauncher('win32', logged().log)(target);
    child.emit('exit', 0);
    expect(await opening).toEqual({ opened: true });
    vi.unstubAllEnvs();
    expect(spawned[0]?.command).toBe('cmd.exe');
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
