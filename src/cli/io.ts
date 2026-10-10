// What a command run touches outside the file system: the output streams,
// the environment, and the prompts. Tests replace all of it.

/** One option of a select or multiselect prompt. */
export interface Choice<V> {
  value: V;
  label?: string;
  hint?: string;
}

export type Validate = (value: string | undefined) => string | undefined;

/** The prompts the TUI uses: @clack/prompts by default, a stub in tests. */
export interface Prompts {
  intro(title?: string): void;
  outro(message?: string): void;
  cancel(message?: string): void;
  note(message?: string, title?: string): void;
  log: Record<
    'info' | 'warn' | 'error' | 'step' | 'success',
    (message: string) => void
  >;
  isCancel(value: unknown): value is symbol;
  multiselect<V>(opts: {
    message: string;
    options: Choice<V>[];
    initialValues?: V[];
    required?: boolean;
  }): Promise<V[] | symbol>;
  select<V>(opts: {
    message: string;
    options: Choice<V>[];
    initialValue?: V;
  }): Promise<V | symbol>;
  text(opts: {
    message: string;
    placeholder?: string;
    initialValue?: string;
    validate?: Validate;
  }): Promise<string | symbol>;
  password(opts: {
    message: string;
    validate?: Validate;
  }): Promise<string | symbol>;
  confirm(opts: {
    message: string;
    initialValue?: boolean;
  }): Promise<boolean | symbol>;
  spinner(): {
    start(message?: string): void;
    stop(message?: string): void;
    error(message?: string): void;
  };
}

export interface Io {
  /** One line of output, for results. */
  stdout: (line: string) => void;
  /** One line of output, for logs and errors. */
  stderr: (line: string) => void;
  env: Record<string, string | undefined>;
  /** Whether stdin and stdout are both terminals. */
  isTTY: boolean;
  /** What relative paths resolve against, and the default root. */
  cwd: string;
  /** The TUI prompts; @clack/prompts when absent. */
  prompts?: Prompts;
}
