// Live updates: while a portal listens on GET /api/events, the directories
// of the schema and of its env files are watched (fs.watch, not recursive),
// and a change to one of those files outside the portal reaches it as an
// SSE `changed` event naming the paths, so it refetches. Nothing is watched
// while nobody listens; closing the server closes the watchers and ends
// every stream.

import { type FSWatcher, watch } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import type { OnModuleDestroy } from '@nestjs/common';
import { nearestReal } from '@configure-env/core';
import type { Response } from 'express';
import { type Project, readSchema } from './project.ts';

/** How long changes are gathered before one event names them all. */
export const DEBOUNCE_MS = 50;
/** How often a comment keeps an idle stream open through proxies. */
export const HEARTBEAT_MS = 25_000;

const STREAM_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-store',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};

export class ProjectEvents implements OnModuleDestroy {
  private readonly clients = new Set<Response>();
  private readonly watchers = new Map<string, FSWatcher>();
  /** The watched files, absolute, by their path relative to the root. */
  private targets = new Map<string, string>();
  private readonly pending = new Set<string>();
  private timer: NodeJS.Timeout | undefined;
  private heartbeat: NodeJS.Timeout | undefined;
  /**
   * Watching the files for the first listener, the others wait for it too;
   * false when it failed.
   */
  private arming: Promise<boolean> | undefined;
  private closed = false;

  constructor(private readonly project: Project) {}

  /**
   * Streams events to `res` until it closes or the server does. The stream
   * answers once the files are watched: a browser's EventSource opens on the
   * response, and a change made as soon as it is open must not be missed.
   */
  async subscribe(res: Response): Promise<void> {
    if (this.closed) {
      res.writeHead(200, STREAM_HEADERS);
      res.end();
      return;
    }
    this.clients.add(res);
    res.on('close', () => this.unsubscribe(res));
    if (!this.arming) {
      const arming: Promise<boolean> = this.arm().then(
        () => true,
        () => {
          // The next listener tries again.
          if (this.arming === arming) this.arming = undefined;
          return false;
        },
      );
      this.arming = arming;
    }
    const watching = await this.arming;
    // It left, or the server closed, while the files were being watched.
    if (!this.clients.has(res) || res.writableEnded) return;
    res.writeHead(200, STREAM_HEADERS);
    if (!watching) {
      // Nothing is watched: the stream ends, and EventSource reconnects
      // after `retry`, which watches again.
      res.write('retry: 1000\n\n');
      res.end();
      return;
    }
    res.write('retry: 1000\n\n: watching\n\n');
  }

  private async arm(): Promise<void> {
    await this.watch();
    if (this.closed || !this.clients.size) return;
    this.heartbeat ??= setInterval(
      () => this.send(': heartbeat\n\n'),
      HEARTBEAT_MS,
    );
    this.heartbeat.unref();
  }

  private unsubscribe(res: Response) {
    this.clients.delete(res);
    if (!this.clients.size) this.stop();
  }

  /** The schema file and the env files it names, by relative path. */
  private async files(): Promise<Map<string, string>> {
    const { root, schemaFile, schemaPath } = this.project;
    const files = new Map([[schemaPath, schemaFile]]);
    const read = await readSchema(this.project);
    for (const file of read.schema?.files ?? [])
      files.set(file.path, join(root, ...file.path.split('/')));
    return files;
  }

  /** Watches the directory of every target: its nearest one inside the root. */
  private async watch(): Promise<void> {
    const { root } = this.project;
    this.targets = await this.files();
    const dirs = new Set<string>();
    for (const absolute of this.targets.values()) {
      const dir = await nearestReal(dirname(absolute)).catch(() => root);
      const rel = relative(root, dir);
      dirs.add(rel.startsWith('..') ? root : dir);
    }
    if (this.closed || !this.clients.size) return;
    for (const [dir, watcher] of this.watchers)
      if (!dirs.has(dir)) {
        watcher.close();
        this.watchers.delete(dir);
      }
    for (const dir of dirs) {
      if (this.watchers.has(dir)) continue;
      try {
        const watcher = watch(dir, { persistent: false }, (_type, name) =>
          this.changed(dir, name),
        );
        watcher.on('error', () => {
          watcher.close();
          this.watchers.delete(dir);
        });
        this.watchers.set(dir, watcher);
      } catch {
        // A directory that went away: the next schema change re-watches.
      }
    }
  }

  /** A watched directory saw `name` change: a target, or a directory on the way to one. */
  private changed(dir: string, name: string | Buffer | null) {
    if (name === null) return;
    const changed = join(dir, name.toString());
    let hit = false;
    for (const [path, absolute] of this.targets) {
      if (absolute === changed) {
        this.pending.add(path);
        hit = true;
      } else if (absolute.startsWith(`${changed}${sep}`)) hit = true;
    }
    if (!hit) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), DEBOUNCE_MS);
  }

  private async flush() {
    const paths = [...this.pending].sort();
    this.pending.clear();
    // The schema names the files: a new one, or a new directory, re-watches.
    await this.watch();
    if (paths.length)
      this.send(`event: changed\ndata: ${JSON.stringify({ paths })}\n\n`);
  }

  /** Writes to every stream that has answered; one still waiting gets none. */
  private send(frame: string) {
    for (const res of this.clients)
      if (res.headersSent && !res.writableEnded) res.write(frame);
  }

  private stop() {
    clearTimeout(this.timer);
    clearInterval(this.heartbeat);
    this.timer = this.heartbeat = undefined;
    this.arming = undefined;
    this.pending.clear();
    for (const watcher of this.watchers.values()) watcher.close();
    this.watchers.clear();
  }

  /** How many directories are watched now; for the tests. */
  get watching(): number {
    return this.watchers.size;
  }

  onModuleDestroy() {
    this.closed = true;
    // A stream still waiting to be answered ends as an event stream too, so
    // the browser's EventSource reconnects rather than giving up.
    for (const res of this.clients) {
      if (!res.headersSent) res.writeHead(200, STREAM_HEADERS);
      res.end();
    }
    this.clients.clear();
    this.stop();
  }
}
