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
 * Deliberately smaller than the real thing: no `addEventListener`, because the one stream on this
 * screen is unnamed-event-only, and no `withCredentials`, because everything is same-origin — which
 * is what carries the session cookie, the same reason {@link ./api-base#QITS_API_BASE} is empty.
 * No `readyState` either: the browser reconnects a dropped stream by itself, so nothing here has a
 * decision to make about the state it is in — `onopen` and `onerror` say everything this app acts
 * on.
 */
export interface EventSourceLike {
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent<string>) => void) | null;
  onerror: ((event: Event) => void) | null;
  close(): void;
}

/** Opens a stream at a URL. One function, so a fake is one function. */
export type EventSourceFactory = (url: string) => EventSourceLike;

/**
 * How this application opens a live stream.
 *
 * A token rather than a bare `new EventSource(url)` for one reason: the stream carries the
 * behaviour most worth testing — invalidate-everything-on-connect, the quiet refresh, the project
 * hop — and none of it is reachable without driving `onopen` and `onmessage` by hand.
 */
export const EVENT_SOURCE_FACTORY = new InjectionToken<EventSourceFactory>('qits.event-source', {
  providedIn: 'root',
  factory: () => (url: string) => new EventSource(url) as EventSourceLike,
});
