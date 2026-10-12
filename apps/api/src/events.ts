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

export class ProjectEvents implements OnModuleDestroy {
  private readonly clients = new Set<Response>();
  private readonly watchers = new Map<string, FSWatcher>();
  /** The watched files, absolute, by their path relative to the root. */
  private targets = new Map<string, string>();
  private readonly pending = new Set<string>();
  private timer: NodeJS.Timeout | undefined;
  private heartbeat: NodeJS.Timeout | undefined;
  private closed = false;

  constructor(private readonly project: Project) {}

  /** Streams events to `res` until it closes or the server does. */
  async subscribe(res: Response): Promise<void> {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    if (this.closed) {
      res.end();
      return;
    }
    this.clients.add(res);
    res.on('close', () => this.unsubscribe(res));
    if (this.clients.size === 1) {
      await this.watch();
      this.heartbeat = setInterval(
        () => this.send(': heartbeat\n\n'),
        HEARTBEAT_MS,
      );
      this.heartbeat.unref();
    }
    if (!res.writableEnded) res.write('retry: 1000\n\n: watching\n\n');
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

  private send(frame: string) {
    for (const res of this.clients) if (!res.writableEnded) res.write(frame);
  }

  private stop() {
    clearTimeout(this.timer);
    clearInterval(this.heartbeat);
    this.timer = this.heartbeat = undefined;
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
    for (const res of this.clients) res.end();
    this.clients.clear();
    this.stop();
  }
}
