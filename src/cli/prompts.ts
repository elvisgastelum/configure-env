// The TUI prompts, backed by @clack/prompts.

import * as clack from '@clack/prompts';
import type { Prompts } from './io.ts';

export const clackPrompts: Prompts = {
  intro: (title) => clack.intro(title),
  outro: (message) => clack.outro(message),
  cancel: (message) => clack.cancel(message),
  note: (message, title) => clack.note(message, title),
  log: {
    info: (message) => clack.log.info(message),
    warn: (message) => clack.log.warn(message),
    error: (message) => clack.log.error(message),
    step: (message) => clack.log.step(message),
    success: (message) => clack.log.success(message),
  },
  isCancel: (value): value is symbol => clack.isCancel(value),
  // clack types its options by value kind; ours are plain value/label/hint.
  multiselect: <V>(opts: Parameters<Prompts['multiselect']>[0]) =>
    clack.multiselect(
      opts as Parameters<typeof clack.multiselect>[0],
    ) as Promise<V[] | symbol>,
  select: <V>(opts: Parameters<Prompts['select']>[0]) =>
    clack.select(opts as Parameters<typeof clack.select>[0]) as Promise<
      V | symbol
    >,
  text: (opts) => clack.text(opts),
  password: (opts) => clack.password(opts),
  confirm: (opts) => clack.confirm(opts),
  spinner: () => clack.spinner(),
};
