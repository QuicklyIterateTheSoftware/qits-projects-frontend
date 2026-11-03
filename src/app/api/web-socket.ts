import { InjectionToken, inject } from '@angular/core';
import { QITS_WEB_SOCKET } from '@qits/angular';

/**
 * The part of `WebSocket` this application uses, named so a spec can hand over something else.
 *
 * A socket is opened by the browser and never goes through `HttpClient`, so `HttpTestingController`
 * has nothing to intercept — and the sign-in terminal's whole behaviour lives in what arrives on
 * the wire: the replayed scrollback, the prompt, the exit note, the clean close. None of it is
 * reachable without driving `onmessage` and `onclose` by hand.
 *
 * Deliberately smaller than the real thing: no `binaryType`, because this socket is text in both
 * directions, and no `addEventListener`, because one handler each is all this app sets. Copied from
 * qits-spa-workspaces rather than shared, the same deliberate per-SPA duplication as `ui/`.
 *
 * `close()` takes no arguments on purpose. The client never closes with a code; only the *server's*
 * code is read, and a 1000 from the server means something this client must not be able to fake.
 */
export interface WebSocketLike {
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent<string>) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  readonly readyState: number;
  send(data: string): void;
  close(): void;
}

/** `WebSocket.OPEN` — the only state in which {@link WebSocketLike.send} is allowed to be called. */
export const WEB_SOCKET_OPEN = 1;

/** Opens a socket at an absolute `ws://` or `wss://` URL. One function, so a fake is one function. */
export type WebSocketFactory = (url: string) => WebSocketLike;

/**
 * How this application opens a socket.
 *
 * Through `@qits/angular`'s `QITS_WEB_SOCKET` (epic qits-543, qits-1348): signed in
 * (`provideQitsBearerSignIn` in `app.config.ts`), that is a `BearerWebSocket`, which offers
 * `['qits.bearer', <token>]` because a browser socket cannot send a header, and the edge moves the
 * token into `Authorization`. It stays `CONNECTING` until the token is in hand, so every sender here
 * already checks {@link WEB_SOCKET_OPEN} before it sends. Every URL it is given is built on this
 * page's own origin, a platform URL, so the bearer goes nowhere else. Without the sign-in it is the
 * browser's own `WebSocket`.
 */
export const WEB_SOCKET_FACTORY = new InjectionToken<WebSocketFactory>('qits.web-socket', {
  providedIn: 'root',
  factory: () => {
    const open = inject(QITS_WEB_SOCKET);
    return (url: string) => open(url);
  },
});
