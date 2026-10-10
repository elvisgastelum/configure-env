// What `set --stdin` reads: one stream to its end, with a limit on the wait
// and on the size, since an agent runner can hand over a pipe that never
// closes.

import type { Readable } from 'node:stream';
import { CliError } from './common.ts';

/** How long `--stdin` waits for more input before it gives up. */
export const STDIN_IDLE_MS = 60_000;

/** The most `--stdin` reads: far more than any secret. */
export const STDIN_MAX_BYTES = 64 * 1024;

/**
 * The whole stream as UTF-8. Exits 2 when `idleMs` pass with no new input,
 * and 1 past `maxBytes`, never echoing what it read; either way the stream
 * is destroyed, so it no longer keeps the process alive.
 */
export function readStream(
  stream: Readable,
  { idleMs = STDIN_IDLE_MS, maxBytes = STDIN_MAX_BYTES } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let timer: NodeJS.Timeout | undefined;
    const settle = (error?: Error) => {
      clearTimeout(timer);
      stream.off('data', onData).off('end', onEnd).off('error', settle);
      if (!error) return resolve(Buffer.concat(chunks).toString('utf8'));
      stream.destroy();
      reject(error);
    };
    const wait = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const seconds = `${Math.round(idleMs / 1000)}s`;
        settle(
          new CliError(2, [
            size
              ? `--stdin got no end of input in ${seconds}; close the pipe after the value`
              : `--stdin got no input in ${seconds}; pipe the value in, such as: <cmd> | configure-env set --stdin KEY`,
          ]),
        );
      }, idleMs);
    };
    const onData = (chunk: Buffer | string) => {
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      if (size > maxBytes)
        return settle(
          new CliError(1, [`--stdin takes at most ${maxBytes} bytes`]),
        );
      chunks.push(bytes);
      wait();
    };
    const onEnd = () => settle();
    stream.on('data', onData).on('end', onEnd).on('error', settle);
    wait();
  });
}
