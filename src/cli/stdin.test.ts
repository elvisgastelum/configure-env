// readStream: what `set --stdin` reads, with an idle timeout and a size cap.

import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { CliError } from './common.ts';
import { readStream, waitText } from './stdin.ts';

const limits = { idleMs: 20, maxBytes: 8 };

describe('readStream', () => {
  it('returns what the stream holds at its end', async () => {
    const stream = new PassThrough();
    const read = readStream(stream, limits);
    stream.write('abc');
    stream.end('def\n');
    expect(await read).toBe('abcdef\n');
  });

  it('exits 2 when no input arrives in time', async () => {
    const stream = new PassThrough();
    const error = await readStream(stream, limits).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CliError);
    expect(error).toMatchObject({ code: 2 });
    expect((error as CliError).lines[0]).toMatch(
      /^--stdin got no input in 20ms; pipe the value in, such as: <cmd> \| configure-env set --stdin KEY$/,
    );
    expect(stream.destroyed).toBe(true);
  });

  it('exits 2 when input stops without an end', async () => {
    const stream = new PassThrough();
    const read = readStream(stream, limits);
    stream.write('abc');
    const error = await read.catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 2 });
    expect((error as CliError).lines).toEqual([
      '--stdin got no end of input in 20ms; close the pipe after the value',
    ]);
    expect(stream.destroyed).toBe(true);
  });

  it('exits 1 for input past maxBytes, never echoing it', async () => {
    const stream = new PassThrough();
    const read = readStream(stream, limits);
    stream.write('secret-v');
    stream.write('alue');
    const error = await read.catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 1 });
    expect((error as CliError).lines.join('\n')).not.toContain('secret');
    expect(stream.destroyed).toBe(true);
  });

  it('passes on a stream error', async () => {
    const stream = new PassThrough();
    const read = readStream(stream, limits);
    stream.destroy(new Error('EIO'));
    await expect(read).rejects.toThrow('EIO');
  });
});

describe('waitText', () => {
  it('names a wait in ms below 1s, else in seconds with one decimal', () => {
    expect([1, 999, 1000, 1500, 60_000].map(waitText)).toEqual([
      '1ms',
      '999ms',
      '1s',
      '1.5s',
      '60s',
    ]);
  });
});
