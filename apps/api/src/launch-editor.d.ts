// launch-editor's own helpers, which src/editor.ts runs instead of its
// launchEditor (that one prints its errors on stdout). Plain CommonJS
// modules without declarations of their own.

declare module 'launch-editor/guess.js' {
  /**
   * The editor command and its arguments: `specifiedEditor` parsed with
   * shell-quote, else $LAUNCH_EDITOR, else a running IDE, else $VISUAL,
   * else $EDITOR; `[null]` when none.
   */
  const guessEditor: (specifiedEditor?: string) => (string | null)[];
  export default guessEditor;
}

declare module 'launch-editor/get-args.js' {
  /**
   * The arguments that open `fileName` at a line and column in `editor`;
   * the line and column may come back as the numbers given.
   */
  const getArgumentsForFile: (
    editor: string,
    fileName: string,
    lineNumber?: number,
    columnNumber?: number,
  ) => (string | number)[];
  export default getArgumentsForFile;
}

declare module 'launch-editor/construct-windows-launch-command.js' {
  /** The cmd.exe command line, its special characters escaped; throws on an unsafe one. */
  const constructWindowsLaunchCommand: (
    editor: string,
    args: string[],
  ) => string;
  export default constructWindowsLaunchCommand;
}
