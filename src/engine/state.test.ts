import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  type FileHandle,
  link,
  mkdir,
  open,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STATE_PATH,
  type State,
  type StateChange,
  applyChanges,
  emptyState,
  fingerprint,
  loadState,
  matchesFingerprint,
  recordFingerprint,
  recorded,
  removeFingerprint,
  updateState,
  withStateLock,
  writeState,
} from './state.ts';
import { useTempRoot } from './test-helpers.ts';

const temp = useTempRoot();
const statePath = () => join(temp.dirs.root, DEFAULT_STATE_PATH);
const modeOf = async (path: string) => (await stat(path)).mode & 0o777;

const SECRET = 'correct horse battery staple';

describe('the state', () => {
  it('is empty when the file is missing, with a fresh 32-byte salt', async () => {
    const result = await loadState(statePath());
    expect(result).toMatchObject({
      ok: true,
      exists: false,
      state: { version: 1, fingerprints: {} },
    });
    if (!result.ok) return;
    expect(Buffer.from(result.state.salt, 'base64')).toHaveLength(32);
    expect(emptyState().salt).not.toBe(result.state.salt);
  });

  it('writes atomically with mode 600 in a directory with mode 700', async () => {
    const state = emptyState();
    recordFingerprint(state, '.env', 'KEY', SECRET);
    await writeState(statePath(), state);
    expect(await modeOf(statePath())).toBe(0o600);
    expect(await modeOf(join(temp.dirs.root, '.configure-env'))).toBe(0o700);
    // No temporary file is left behind.
    expect(await readdir(join(temp.dirs.root, '.configure-env'))).toEqual([
      'state.json',
    ]);
    const loaded = await loadState(statePath());
    expect(loaded).toEqual({ ok: true, exists: true, state });
  });

  it('never holds the value, only its HMAC', async () => {
    const state = emptyState();
    recordFingerprint(state, '.env', 'KEY', SECRET);
    await writeState(statePath(), state);
    const text = await readFile(statePath(), 'utf8');
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(Buffer.from(SECRET).toString('base64'));
    expect(text).not.toContain(Buffer.from(SECRET).toString('hex'));
    const entry = recorded(state, '.env', 'KEY')!;
    expect(entry.hmac).toMatch(/^[0-9a-f]{64}$/);
    expect(entry.hmac).toBe(fingerprint(state.salt, SECRET));
    expect(entry.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('keys fingerprints by file and variable, with a salt per state', () => {
    const state = emptyState();
    recordFingerprint(state, '.env', 'KEY', SECRET);
    expect(matchesFingerprint(state, '.env', 'KEY', SECRET)).toBe(true);
    expect(matchesFingerprint(state, '.env', 'KEY', `${SECRET}!`)).toBe(false);
    expect(recorded(state, 'other.env', 'KEY')).toBeUndefined();
    expect(fingerprint(emptyState().salt, SECRET)).not.toBe(
      recorded(state, '.env', 'KEY')!.hmac,
    );
  });

  it('keeps the date of a value recorded again, and drops a removed one', () => {
    const state = emptyState();
    const first = new Date('2026-01-02T03:04:05Z');
    expect(recordFingerprint(state, '.env', 'KEY', SECRET, first)).toBe(true);
    expect(recordFingerprint(state, '.env', 'KEY', SECRET)).toBe(false);
    expect(recorded(state, '.env', 'KEY')!.recordedAt).toBe(
      first.toISOString(),
    );
    expect(removeFingerprint(state, '.env', 'KEY')).toBe(true);
    expect(state.fingerprints).toEqual({});
    expect(removeFingerprint(state, '.env', 'KEY')).toBe(false);
  });

  it('refuses to write or read through a symlink', async () => {
    const elsewhere = join(await temp.another(), 'target.json');
    await writeFile(elsewhere, '{}');
    await mkdir(join(temp.dirs.root, '.configure-env'));
    await symlink(elsewhere, statePath());
    await expect(writeState(statePath(), emptyState())).rejects.toThrow(
      /is a symlink/,
    );
    expect(await readFile(elsewhere, 'utf8')).toBe('{}');
    expect(await loadState(statePath())).toEqual({
      ok: false,
      message: `${statePath()}: is a symlink; refusing to read through it`,
    });
  });

  it.each([
    ['text that is not JSON', 'nope', 'is not valid JSON'],
    ['another version', { version: 2 }, 'version: must be 1'],
    [
      'a short salt',
      { version: 1, salt: 'AAAA', fingerprints: {} },
      'salt: must be 32 bytes in base64',
    ],
    [
      'a bad fingerprint',
      {
        version: 1,
        salt: Buffer.alloc(32).toString('base64'),
        fingerprints: { '.env': { KEY: { hmac: 'xyz', recordedAt: 'x' } } },
      },
      'fingerprints[".env"].KEY.hmac',
    ],
    [
      'an unknown field',
      {
        version: 1,
        salt: Buffer.alloc(32).toString('base64'),
        fingerprints: {},
        values: {},
      },
      'values',
    ],
  ])('rejects %s, naming the path', async (_label, content, message) => {
    await mkdir(join(temp.dirs.root, '.configure-env'));
    await writeFile(
      statePath(),
      typeof content === 'string' ? content : JSON.stringify(content),
    );
    const result = await loadState(statePath());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain(statePath());
    expect(result.message).toContain(message);
  });

  it('round-trips a state with several files', async () => {
    const state: State = emptyState();
    recordFingerprint(state, '.env', 'A', 'one');
    recordFingerprint(state, 'deploy/.env', 'A', 'one');
    await writeState(statePath(), state);
    const loaded = await loadState(statePath());
    expect(loaded.ok && loaded.state).toEqual(state);
    expect(recorded(state, '.env', 'A')!.hmac).toBe(
      recorded(state, 'deploy/.env', 'A')!.hmac,
    );
  });
});

const record = (
  file: string,
  key: string,
  value: string,
  replace = false,
): StateChange => ({ action: 'record', file, key, value, replace });

describe('applyChanges', () => {
  it('records a value only where none is recorded, unless it replaces', () => {
    const state = emptyState();
    recordFingerprint(state, '.env', 'KEY', 'old', new Date('2026-01-01'));
    expect(applyChanges(state, [record('.env', 'KEY', 'edited')])).toBe(false);
    expect(matchesFingerprint(state, '.env', 'KEY', 'old')).toBe(true);
    expect(applyChanges(state, [record('.env', 'KEY', 'new', true)])).toBe(
      true,
    );
    expect(matchesFingerprint(state, '.env', 'KEY', 'new')).toBe(true);
    expect(
      applyChanges(state, [{ action: 'remove', file: '.env', key: 'KEY' }]),
    ).toBe(true);
    expect(state.fingerprints).toEqual({});
  });
});

describe('updateState', () => {
  it('keeps the fingerprints of two runs that both loaded an empty state', async () => {
    await Promise.all([
      updateState(statePath(), [record('.env', 'A', 'one')]),
      updateState(statePath(), [record('worker.env', 'B', 'two')]),
    ]);
    const loaded = await loadState(statePath());
    if (!loaded.ok) throw new Error(loaded.message);
    expect(matchesFingerprint(loaded.state, '.env', 'A', 'one')).toBe(true);
    expect(matchesFingerprint(loaded.state, 'worker.env', 'B', 'two')).toBe(
      true,
    );
    // The lock is gone.
    expect(await readdir(join(temp.dirs.root, '.configure-env'))).toEqual([
      'state.json',
    ]);
  });

  it('keeps the salt and the entries on disk, applying only its changes', async () => {
    const disk = emptyState();
    recordFingerprint(disk, '.env', 'OTHER', 'kept');
    recordFingerprint(disk, '.env', 'GONE', 'removed');
    await writeState(statePath(), disk);
    expect(
      await updateState(statePath(), [
        record('.env', 'KEY', SECRET),
        { action: 'remove', file: '.env', key: 'GONE' },
      ]),
    ).toBe(true);
    const loaded = await loadState(statePath());
    if (!loaded.ok) throw new Error(loaded.message);
    expect(loaded.state.salt).toBe(disk.salt);
    expect(Object.keys(loaded.state.fingerprints['.env']!).sort()).toEqual([
      'KEY',
      'OTHER',
    ]);
    expect(matchesFingerprint(loaded.state, '.env', 'KEY', SECRET)).toBe(true);
  });

  it('writes nothing when the changes change nothing', async () => {
    expect(await updateState(statePath(), [])).toBe(false);
    expect(
      await updateState(statePath(), [
        { action: 'remove', file: '.env', key: 'KEY' },
      ]),
    ).toBe(false);
    await expect(stat(statePath())).rejects.toThrow();
  });

  it('lets simultaneous runs take the lock in turn', async () => {
    const keys = ['A', 'B', 'C', 'D', 'E', 'F'];
    await Promise.all(
      keys.map((key) => updateState(statePath(), [record('.env', key, key)])),
    );
    const loaded = await loadState(statePath());
    if (!loaded.ok) throw new Error(loaded.message);
    for (const key of keys)
      expect(matchesFingerprint(loaded.state, '.env', key, key)).toBe(true);
    expect(await readdir(join(temp.dirs.root, '.configure-env'))).toEqual([
      'state.json',
    ]);
  });

  it('writes its pid, host and a token in the lock, with mode 600', async () => {
    const lock = `${statePath()}.lock`;
    await withStateLock(statePath(), async () => {
      expect((await stat(lock)).mode & 0o777).toBe(0o600);
      expect(JSON.parse(await readFile(lock, 'utf8'))).toEqual({
        pid: process.pid,
        host: hostname(),
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        token: expect.stringMatching(/^[0-9a-f]{32}$/),
      });
    });
    await expect(stat(lock)).rejects.toThrow();
  });

  it('never removes a lock it did not create', async () => {
    const lock = `${statePath()}.lock`;
    const other = JSON.stringify({ pid: 1, host: 'elsewhere', token: 'x' });
    await withStateLock(statePath(), async () => {
      // Someone removed this run's lock, and another run took it.
      await writeFile(lock, other);
    });
    expect(await readFile(lock, 'utf8')).toBe(other);
  });

  describe('a lock held by another run', () => {
    const hold = async (content: string) => {
      await mkdir(join(temp.dirs.root, '.configure-env'), { recursive: true });
      await writeFile(`${statePath()}.lock`, content);
    };
    const attempt = () =>
      updateState(statePath(), [record('.env', 'KEY', SECRET)], {
        waitMs: 100,
      });

    it('names a live process, and is left in place', async () => {
      const content = JSON.stringify({ pid: process.pid, host: hostname() });
      await hold(content);
      await expect(attempt()).rejects.toThrow(
        `${statePath()}.lock: held by process ${process.pid}; try again`,
      );
      expect(await readFile(`${statePath()}.lock`, 'utf8')).toBe(content);
      await expect(stat(statePath())).rejects.toThrow();
    });

    it('names a process of this host that is no longer running', async () => {
      const { pid } = spawnSync(process.execPath, ['-e', '']);
      await hold(JSON.stringify({ pid, host: hostname() }));
      await expect(attempt()).rejects.toThrow(
        `${statePath()}.lock: left by process ${pid}, which is no longer running; remove it and try again`,
      );
    });

    it('names another host it can read, and tells to remove it', async () => {
      await hold(JSON.stringify({ pid: 1, host: 'elsewhere' }));
      await expect(attempt()).rejects.toThrow(
        `${statePath()}.lock: held by another run (elsewhere); if none is running, remove it`,
      );
    });

    it.each([
      ['empty', ''],
      ['partial', '{"pid": 12'],
      ['pid 0', JSON.stringify({ pid: 0, host: hostname() })],
      ['a negative pid', JSON.stringify({ pid: -1, host: hostname() })],
      ['no host', JSON.stringify({ pid: 1 })],
    ])(
      'asks to try again, then to remove it, when its owner is %s',
      async (_label, text) => {
        await hold(text);
        await expect(attempt()).rejects.toThrow(
          new RegExp(
            `^${statePath()}\\.lock: held by another run; try again, and if this persists, remove it$`,
          ),
        );
        expect(await readFile(`${statePath()}.lock`, 'utf8')).toBe(text);
      },
    );
  });

  describe('creating the lock', () => {
    const lock = () => `${statePath()}.lock`;
    /** An open whose handles fail to write, as a full disk makes them. */
    const failingOpen = (async (...args: Parameters<typeof open>) => {
      const handle = await open(...args);
      handle.writeFile = (async () => {
        throw new Error('disk full');
      }) as never;
      return handle;
    }) as typeof open;
    const noLink = (async () => {
      throw Object.assign(new Error('no hard links'), { code: 'ENOTSUP' });
    }) as typeof link;
    /** An open that acts on the lock itself (not its temporary file). */
    const onLock = (
      act: (args: Parameters<typeof open>) => Promise<FileHandle>,
    ) =>
      (async (...args: Parameters<typeof open>) =>
        String(args[0]).endsWith('.lock')
          ? act(args)
          : open(...args)) as typeof open;
    const entries = () => readdir(join(temp.dirs.root, '.configure-env'));
    const lockWith = (fs: Partial<{ open: typeof open; link: typeof link }>) =>
      withStateLock(statePath(), async () => 'ran', { fs });

    it('leaves no lock when its owner cannot be written', async () => {
      await expect(lockWith({ open: failingOpen })).rejects.toThrow(
        'disk full',
      );
      expect(await entries()).toEqual([]);
    });

    describe('without hard links', () => {
      it('removes the lock it created when its owner cannot be written', async () => {
        await expect(
          lockWith({
            link: noLink,
            open: onLock((args) => failingOpen(...args)),
          }),
        ).rejects.toThrow('disk full');
        expect(await entries()).toEqual([]);
      });

      it('compares and removes the lock before it closes its handle', async () => {
        const calls: string[] = [];
        const ordered = onLock(async (args) => {
          const handle = await open(...args);
          const stat = handle.stat.bind(handle);
          const close = handle.close.bind(handle);
          handle.writeFile = (async () => {
            throw new Error('disk full');
          }) as never;
          handle.stat = (async (...rest: Parameters<typeof stat>) => {
            calls.push('stat');
            return stat(...rest);
          }) as never;
          handle.close = async () => {
            // The lock is gone before its handle closes.
            calls.push(existsSync(lock()) ? 'close, lock there' : 'close');
            return close();
          };
          return handle;
        });
        await expect(lockWith({ link: noLink, open: ordered })).rejects.toThrow(
          'disk full',
        );
        expect(calls).toEqual(['stat', 'close']);
        expect(await entries()).toEqual([]);
      });

      it('leaves the lock when it cannot prove the file is its own', async () => {
        const noStat = onLock(async (args) => {
          const handle = await open(...args);
          handle.writeFile = (async () => {
            throw new Error('disk full');
          }) as never;
          handle.stat = (async () => {
            throw new Error('fstat failed');
          }) as never;
          return handle;
        });
        await expect(lockWith({ link: noLink, open: noStat })).rejects.toThrow(
          'disk full',
        );
        // An empty lock, which the held message asks a person to remove.
        expect(await readFile(lock(), 'utf8')).toBe('');
      });

      it('removes the lock it created when closing it fails', async () => {
        const closeFails = onLock(async (args) => {
          const handle = await open(...args);
          const close = handle.close.bind(handle);
          handle.close = async () => {
            await close();
            throw new Error('close failed');
          };
          return handle;
        });
        await expect(
          lockWith({ link: noLink, open: closeFails }),
        ).rejects.toThrow('close failed');
        expect(await entries()).toEqual([]);
      });

      describe('when closing it fails', () => {
        /** An open whose lock handle closes, runs `after`, then throws. */
        const closeThen = (after: () => Promise<void>) =>
          onLock(async (args) => {
            const handle = await open(...args);
            const close = handle.close.bind(handle);
            handle.close = async () => {
              await close();
              await after();
              throw new Error('close failed');
            };
            return handle;
          });
        const theirs = JSON.stringify({
          pid: 1,
          host: 'elsewhere',
          token: 'theirs',
        });

        it.each([
          [
            "another run's token",
            async () => {
              await unlink(lock());
              await writeFile(lock(), theirs);
            },
            theirs,
          ],
          [
            'an owner it cannot parse',
            async () => {
              await unlink(lock());
              await writeFile(lock(), 'garbage');
            },
            'garbage',
          ],
        ])(
          'leaves a lock holding %s, reporting the close error',
          async (_label, after, content) => {
            await expect(
              lockWith({ link: noLink, open: closeThen(after) }),
            ).rejects.toThrow('close failed');
            expect(await readFile(lock(), 'utf8')).toBe(content);
          },
        );

        it('reports the close error when the lock is gone', async () => {
          await expect(
            lockWith({ link: noLink, open: closeThen(() => unlink(lock())) }),
          ).rejects.toThrow('close failed');
          expect(await entries()).toEqual([]);
        });

        it('reports the close error and leaves a lock it cannot read', async () => {
          // A read that fails (EISDIR) counts as not ours.
          const unreadable = closeThen(async () => {
            await unlink(lock());
            await mkdir(lock());
          });
          try {
            await expect(
              lockWith({ link: noLink, open: unreadable }),
            ).rejects.toThrow('close failed');
            expect((await stat(lock())).isDirectory()).toBe(true);
          } finally {
            await rm(lock(), { recursive: true, force: true });
          }
        });
      });

      it('never removes a file that replaced the lock it created', async () => {
        const replaced = onLock(async (args) => {
          const handle = await open(...args);
          handle.writeFile = (async () => {
            await unlink(lock());
            await writeFile(lock(), 'theirs');
            throw new Error('disk full');
          }) as never;
          return handle;
        });
        await expect(
          lockWith({ link: noLink, open: replaced }),
        ).rejects.toThrow('disk full');
        expect(await readFile(lock(), 'utf8')).toBe('theirs');
      });

      it('never removes a lock after its own open failed', async () => {
        await mkdir(join(temp.dirs.root, '.configure-env'));
        await writeFile(lock(), 'theirs');
        const tooMany = onLock(async () => {
          throw Object.assign(new Error('too many open files'), {
            code: 'EMFILE',
          });
        });
        await expect(lockWith({ link: noLink, open: tooMany })).rejects.toThrow(
          'too many open files',
        );
        expect(await readFile(lock(), 'utf8')).toBe('theirs');
      });
    });

    it.each(['EPERM', 'ENOTSUP', 'EXDEV', 'ENOSYS'])(
      'falls back to an exclusive create when link fails with %s',
      async (code) => {
        const linkFails = (async () => {
          throw Object.assign(new Error('no hard links'), { code });
        }) as typeof link;
        await withStateLock(
          statePath(),
          async () => {
            expect(JSON.parse(await readFile(lock(), 'utf8')).pid).toBe(
              process.pid,
            );
            expect((await stat(lock())).mode & 0o777).toBe(0o600);
          },
          { fs: { link: linkFails } },
        );
        expect(await entries()).toEqual([]);
      },
    );

    it('tries once more at the deadline when the lock is gone', async () => {
      // The first link finds a lock, which is gone by the deadline.
      let calls = 0;
      const busyOnce = (async (...args: Parameters<typeof link>) => {
        if (!calls++)
          throw Object.assign(new Error('exists'), { code: 'EEXIST' });
        return link(...args);
      }) as typeof link;
      expect(
        await withStateLock(statePath(), async () => 'ran', {
          waitMs: 0,
          fs: { link: busyOnce },
        }),
      ).toBe('ran');
      expect(calls).toBe(2);
    });
  });

  it('writes through the given writer, keeping the state on disk when it fails', async () => {
    const disk = emptyState();
    await writeState(statePath(), disk);
    await expect(
      updateState(statePath(), [record('.env', 'KEY', SECRET)], {
        write: async () => {
          throw new Error('disk full');
        },
      }),
    ).rejects.toThrow('disk full');
    const loaded = await loadState(statePath());
    expect(loaded.ok && loaded.state).toEqual(disk);
    await expect(stat(`${statePath()}.lock`)).rejects.toThrow();
  });
});
