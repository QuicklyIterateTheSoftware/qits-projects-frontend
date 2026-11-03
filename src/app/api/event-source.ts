import { InjectionToken, inject } from '@angular/core';
import { FetchEventSource, QITS_SIGN_IN_FETCH, QitsTokens } from '@qits/angular';

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
 * screen is unnamed-event-only, and no `withCredentials`: the streams are signed in with the bearer
 * ({@link BearerEventSource}), not with a cookie.
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

/** `EventSource.CONNECTING` and `OPEN`, without reading the global (jsdom has none). */
const CONNECTING = 0;
const OPEN = 1;

/** How long a dropped stream waits before it reconnects — the browser's own default for `EventSource`. */
export const RECONNECT_MS = 3000;

/**
 * An `EventSource` that signs in with the bearer (epic qits-543, qits-1348), and behaves like the
 * browser's own in the two ways this application leans on.
 *
 * `@qits/angular`'s {@link FetchEventSource} reads the stream with `fetch()` so it can send
 * `Authorization: Bearer`, which `EventSource` cannot — but it is deliberately bare: no `onopen`,
 * no reconnect, and a refusal looks like a drop. Every stream here is built on the opposite: the
 * hint channels invalidate everything **on connect** and rely on the browser **reconnecting** a
 * dropped stream by itself, and the technical-process log tells a stream that closed for good (an
 * evicted process id answers 404) from one about to retry. So this wraps one `FetchEventSource` per
 * attempt and puts back what `EventSource` does:
 *
 * - `onopen` when the response is a 2xx with a body — the moment `EventSource` fires it;
 * - a non-2xx answer is fatal: `CLOSED`, then `onerror`, and nothing reopens it;
 * - a dropped or ended stream (or a network failure) is `CONNECTING`, then `onerror`, and a new
 *   attempt after {@link RECONNECT_MS}, which asks for a fresh token first.
 */
export class BearerEventSource implements EventSourceLike {
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readyState = CONNECTING;

  private current: FetchEventSource | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly url: string,
    private readonly token: () => Promise<string | null>,
    private readonly fetchFn: typeof fetch = (input, init) => fetch(input, init),
    private readonly reconnectMs = RECONNECT_MS,
  ) {
    this.connect();
  }

  close(): void {
    this.readyState = EVENT_SOURCE_CLOSED;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    const current = this.current;
    this.current = null;
    current?.close();
  }

  private connect(): void {
    let status: number | null = null;
    const attempt: FetchEventSource = new FetchEventSource(
      this.url,
      this.token,
      async (input, init) => {
        const response = await this.fetchFn(input, init);
        status = response.status;
        if (response.ok && response.body && this.current === attempt) {
          this.readyState = OPEN;
          this.onopen?.(new Event('open'));
        }
        return response;
      },
    );
    attempt.onmessage = (event) => {
      if (this.current === attempt) this.onmessage?.(event);
    };
    attempt.onerror = () => {
      if (this.current !== attempt) return;
      this.current = null;
      const refused = status !== null && (status < 200 || status > 299);
      if (refused) {
        this.readyState = EVENT_SOURCE_CLOSED;
        this.onerror?.(new Event('error'));
        return;
      }
      this.readyState = CONNECTING;
      this.onerror?.(new Event('error'));
      if (this.readyState === EVENT_SOURCE_CLOSED) return;
      this.retry = setTimeout(() => {
        this.retry = null;
        if (this.readyState !== EVENT_SOURCE_CLOSED) this.connect();
      }, this.reconnectMs);
    };
    this.current = attempt;
  }
}

/**
 * How this application opens a live stream.
 *
 * A token rather than a bare `new EventSource(url)` for one reason: the streams carry the behaviour
 * most worth testing — invalidate-everything-on-connect, the quiet refresh, the project hop,
 * rebuild-from-replay, the terminal frame — and none of it is reachable without driving `onopen` and
 * `onmessage` by hand.
 *
 * Signed in (`provideQitsBearerSignIn` in `app.config.ts`), it opens a {@link BearerEventSource}
 * with the sign-in's token; every URL it is given is this page's own origin
 * ({@link ./api-base#QITS_API_BASE} is empty), which is a platform URL, so the bearer goes nowhere
 * else. Without the sign-in (a spec that provides none) it is the browser's own `EventSource`.
 */
export const EVENT_SOURCE_FACTORY = new InjectionToken<EventSourceFactory>('qits.event-source', {
  providedIn: 'root',
  factory: () => {
    const tokens = inject(QitsTokens, { optional: true });
    if (!tokens) return (url: string) => new EventSource(url) as EventSourceLike;
    const fetchFn = inject(QITS_SIGN_IN_FETCH);
    return (url: string) => new BearerEventSource(url, () => tokens.accessToken(), fetchFn);
  },
});
