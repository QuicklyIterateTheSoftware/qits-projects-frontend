import { InjectionToken } from '@angular/core';

/**
 * The part of `EventSource` this application uses, named so a spec can hand over something else.
 *
 * Angular ships no server-sent-event client and there is nothing to mock in `HttpTestingController`
 * — an `EventSource` is opened by the browser and never goes through `HttpClient`. So the seam has
 * to be the constructor itself, and this interface is what both sides of it agree on. It is the
 * same shape, and the same reasoning, as `web-socket.ts` beside it: a browser primitive this app
 * cannot otherwise drive, named down to the members it actually sets.
 *
 * Deliberately smaller than the real thing: no `addEventListener`, because every stream on this
 * screen is unnamed-event-only, and no `withCredentials`, because everything is same-origin — which
 * is what carries the session cookie, the same reason {@link ./api-base#QITS_API_BASE} is empty.
 *
 * `readyState` is **optional**, and the optionality is the point rather than laziness. Most streams
 * here never look at it: the browser reconnects a dropped stream by itself, so `onopen` and `onerror`
 * say everything a hint channel acts on. The one reader is the refining page's technical-process log,
 * where a stream that closed for good is a *different state* from one about to retry — a process id
 * the server has evicted answers 404, which the browser treats as fatal. So a fake that never needs
 * the distinction may leave the member off, and one that tests it sets it.
 */
export interface EventSourceLike {
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent<string>) => void) | null;
  onerror: ((event: Event) => void) | null;
  readonly readyState?: number;
  close(): void;
}

/** `EventSource.CLOSED` — the browser has given up and will not retry by itself. */
export const EVENT_SOURCE_CLOSED = 2;

/** Opens a stream at a URL. One function, so a fake is one function. */
export type EventSourceFactory = (url: string) => EventSourceLike;

/**
 * How this application opens a live stream.
 *
 * A token rather than a bare `new EventSource(url)` for one reason: the streams carry the behaviour
 * most worth testing — invalidate-everything-on-connect, the quiet refresh, the project hop,
 * rebuild-from-replay, the terminal frame — and none of it is reachable without driving `onopen` and
 * `onmessage` by hand.
 */
export const EVENT_SOURCE_FACTORY = new InjectionToken<EventSourceFactory>('qits.event-source', {
  providedIn: 'root',
  factory: () => (url: string) => new EventSource(url) as EventSourceLike,
});
