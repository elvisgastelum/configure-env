// jsdom has no EventSource: the `eventsource` polyfill (over fetch, which
// msw intercepts) stands in, so msw's `sse()` handlers mock GET /api/events.
// It loads before the handlers, which need EventSource to exist.

import { EventSource } from 'eventsource';

globalThis.EventSource ??=
  EventSource as unknown as typeof globalThis.EventSource;
