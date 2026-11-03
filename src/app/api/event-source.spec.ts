import { BearerEventSource, EVENT_SOURCE_CLOSED } from './event-source';

/** A response whose body is the given SSE text, then ends. */
function streamOf(text: string, status = 200): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { 'content-type': 'text/event-stream' } });
}

/** A response whose body stays open until the test ends it. */
function openStream(): { response: Response; end: () => void } {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return { response: new Response(body, { status: 200 }), end: () => controller.close() };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * The bearer stream behaves like the browser's `EventSource` where this app leans on it: `onopen` on
 * connect, a reconnect after a drop, and a refusal that is final (epic qits-543, qits-1348).
 */
describe('BearerEventSource', () => {
  it('sends the bearer, opens, and delivers unnamed messages', async () => {
    const live = openStream();
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => live.response);
    const source = new BearerEventSource('/projects/api/x/events', async () => 'token-1', fetchFn);
    const opened = vi.fn();
    const messages: string[] = [];
    source.onopen = opened;
    source.onmessage = (event) => messages.push(event.data);
    await settle();

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('/projects/api/x/events');
    expect((init?.headers as Record<string, string>)['authorization']).toBe('Bearer token-1');
    expect(opened).toHaveBeenCalledTimes(1);
    expect(source.readyState).toBe(1);
    source.close();
    live.end();
  });

  it('delivers the messages of a stream', async () => {
    const fetchFn = vi.fn(async () => streamOf('data: work\n\nevent: named\ndata: no\n\n'));
    const source = new BearerEventSource('/e', async () => 't', fetchFn, 60_000);
    const messages: string[] = [];
    source.onmessage = (event) => messages.push(event.data);
    await settle();

    expect(messages).toEqual(['work']);
    source.close();
  });

  it('reconnects after the stream ends, and opens again', async () => {
    const fetchFn = vi.fn(async () => streamOf('data: a\n\n'));
    const source = new BearerEventSource('/e', async () => 't', fetchFn, 0);
    const opened = vi.fn();
    const errors: number[] = [];
    source.onopen = opened;
    source.onerror = () => errors.push(source.readyState);
    await settle();

    expect(fetchFn.mock.calls.length).toBeGreaterThan(1);
    expect(opened.mock.calls.length).toBeGreaterThan(1);
    expect(errors[0]).toBe(0);
    source.close();
  });

  it('treats a refusal as final, as EventSource does', async () => {
    const fetchFn = vi.fn(async () => new Response('gone', { status: 404 }));
    const source = new BearerEventSource('/e', async () => 't', fetchFn, 0);
    const opened = vi.fn();
    const errors: number[] = [];
    source.onopen = opened;
    source.onerror = () => errors.push(source.readyState);
    await settle();

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(opened).not.toHaveBeenCalled();
    expect(errors).toEqual([EVENT_SOURCE_CLOSED]);
    expect(source.readyState).toBe(EVENT_SOURCE_CLOSED);
  });

  it('stays closed once closed, and reports nothing more', async () => {
    const fetchFn = vi.fn(async () => streamOf('data: a\n\n'));
    const source = new BearerEventSource('/e', async () => 't', fetchFn, 0);
    const errors = vi.fn();
    source.onerror = errors;
    source.close();
    await settle();

    expect(errors).not.toHaveBeenCalled();
    expect(source.readyState).toBe(EVENT_SOURCE_CLOSED);
  });
});
