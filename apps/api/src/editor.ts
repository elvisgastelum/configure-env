// Opening a project file in the user's editor at a line: which files may be
// opened (the schema file and its env files, inside the root, never through
// a symlink), where the line is (the dotenv parser for an env file, a JSON
// source map for the schema), and the launcher, launch-editor behind a seam
// the tests replace, so no test ever starts an editor.

import { readFile } from 'node:fs/promises';
import { isIPv4 } from 'node:net';
import {
  type TextPosition,
  entryPosition,
  filePathProblem,
  formatIssuePath,
  jsonPathPosition,
  parseDotenv,
  resolveTarget,
} from '@configure-env/core';
import launchEditor from 'launch-editor';
import type { z } from 'zod';
import type { openInEditorRequest, openInEditorResponse } from './contracts.ts';
import { ApiError } from './http.ts';
import { type Project, readSchema } from './project.ts';

/** A file to open: its absolute path and the 1-based position. */
export interface EditorTarget extends TextPosition {
  file: string;
}

/** Whether the editor was started; when not, why, for the portal to say. */
export type LaunchResult =
  | { opened: true }
  | { opened: false; reason: 'no-editor' | 'failed'; message: string };

/** Opens a file in the user's editor. */
export type EditorLauncher = (target: EditorTarget) => Promise<LaunchResult>;

export const NO_EDITOR_MESSAGE =
  'No editor was found: set $LAUNCH_EDITOR, $VISUAL or $EDITOR, or open VS Code, Cursor, Zed or a JetBrains IDE.';

/** How long a launch may take to fail before it counts as opened. */
const SETTLE_MS = 300;

/**
 * The editor command to pass to launch-editor, by precedence: none when
 * $LAUNCH_EDITOR is set (launch-editor reads it itself, as one command),
 * else $VISUAL, else $EDITOR; none lets launch-editor detect a running
 * VS Code, Cursor, Zed or JetBrains IDE.
 */
export function editorCommand(env: NodeJS.ProcessEnv): string | undefined {
  if (env.LAUNCH_EDITOR) return undefined;
  return env.VISUAL || env.EDITOR || undefined;
}

// cmd.exe expands these even inside quotes; launch-editor runs through it on
// Windows, so a file name holding one is not passed.
const UNSAFE_ON_WINDOWS = /[%!"^\r\n]/;

/**
 * The launcher of `configure-env serve`: launch-editor, which spawns the
 * editor with the file as an argument (no shell, but on Windows). A launch
 * that fails within a moment (no editor found, a command that does not
 * exist) answers why; after that, it counts as opened.
 */
export function createLauncher(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): EditorLauncher {
  return ({ file, line, column }) =>
    new Promise((resolve) => {
      if (platform === 'win32' && UNSAFE_ON_WINDOWS.test(file)) {
        resolve({
          opened: false,
          reason: 'failed',
          message: 'the file name holds a character the Windows shell expands',
        });
        return;
      }
      let settled = false;
      const settle = (result: LaunchResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const timer = setTimeout(() => settle({ opened: true }), SETTLE_MS);
      const onError = (_file: string, message: string | null) =>
        settle(
          message === null
            ? { opened: false, reason: 'no-editor', message: NO_EDITOR_MESSAGE }
            : {
                opened: false,
                reason: 'failed',
                message: `the editor could not open the file: ${message}`,
              },
        );
      // Always with a position: a file name ending in `:12` is then never
      // read as one.
      const spec = `${file}:${line}:${column}`;
      const command = editorCommand(env);
      try {
        if (command) launchEditor(spec, command, onError);
        else launchEditor(spec, onError);
      } catch (error) {
        settle({
          opened: false,
          reason: 'failed',
          message: `the editor could not open the file: ${(error as Error).message}`,
        });
      }
    });
}

/** Whether a socket's remote address is this machine. */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  if (address === '::1') return true;
  const v4 = address.startsWith('::ffff:') ? address.slice(7) : address;
  return isIPv4(v4) && v4.startsWith('127.');
}

type Request = z.output<typeof openInEditorRequest>;
type Response = z.output<typeof openInEditorResponse>;

const START: TextPosition = { line: 1, column: 1 };

/** Where to open: the position asked, else the one the key or path resolves to. */
function positionIn(
  text: string,
  body: Request,
  isSchema: boolean,
): TextPosition {
  if (body.line !== undefined)
    return { line: body.line, column: body.column ?? 1 };
  if (isSchema) {
    const path =
      body.path ??
      (body.key === undefined
        ? undefined
        : formatIssuePath(['variables', body.key]));
    return (path && jsonPathPosition(text, path)) || START;
  }
  return (
    (body.key !== undefined && entryPosition(parseDotenv(text), body.key)) ||
    START
  );
}

/**
 * Opens the schema file or one of its env files at a position. Refuses a
 * path that is not a plain relative one or that leads out of the root (403),
 * a file the project does not list or that does not exist (404), and a JSON
 * path for an env file (422).
 */
export async function openInEditor(
  project: Project,
  body: Request,
  launcher: EditorLauncher,
): Promise<Response> {
  const { file } = body;
  const problem = filePathProblem(file);
  if (problem) throw new ApiError(403, `${file}: ${problem}`);
  const isSchema = file === project.schemaPath;
  // An invalid schema still opens itself: that is where its errors are.
  if (!isSchema) {
    const { schema } = await readSchema(project);
    if (!schema?.files.some((spec) => spec.path === file))
      throw new ApiError(
        404,
        `${file} is not the schema file or one of its env files`,
      );
    if (body.path !== undefined)
      throw new ApiError(
        422,
        `${file}: a JSON path applies to the schema file only`,
      );
  }
  const target = await resolveTarget(project.root, file);
  if (!target.ok) throw new ApiError(403, `${file}: ${target.message}`);
  if (!target.exists) throw new ApiError(404, `${file}: no such file`);
  const position = positionIn(
    await readFile(target.absolute, 'utf8'),
    body,
    isSchema,
  );
  const result = await launcher({ file: target.absolute, ...position });
  return { ...result, file, ...position };
}
