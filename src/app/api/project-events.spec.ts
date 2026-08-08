import { TestBed } from '@angular/core/testing';
import { EVENT_SOURCE_FACTORY, type EventSourceLike } from './event-source';
import { PROJECT_TOPICS, ProjectEvents, type ProjectTopic } from './project-events';

/** A stream whose every lifecycle moment is a method call. */
class FakeStream implements EventSourceLike {
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;

  constructor(readonly url: string) {}

  close(): void {
    this.closed = true;
  }

  connect(): void {
    this.onopen?.(new Event('open'));
  }

  emit(topic: string): void {
    this.onmessage?.(new MessageEvent<string>('message', { data: topic }));
  }

  drop(): void {
    this.onerror?.(new Event('error'));
  }
}

/**
 * The one live-data rule worth a spec of its own: **on every connect, and every reconnect,
 * invalidate everything.**
 *
 * The server offers no replay protocol, no `Last-Event-ID` and no resume token, and a client that
 * invented one would be guessing about frames it never saw. Re-fetching every topic on open closes
 * whatever gap the disconnected window left, for the price of one burst of requests — and it removes
 * an entire class of bugs in which the page is quietly wrong about something it stopped hearing
 * about.
 *
 * The timers are faked deliberately, and the last assertion is why: **this client must never
 * schedule anything.** A poll added here would put a traffic floor under a project nobody is
 * changing, which is the exact cost the channel exists to remove. A timer count of zero after an
 * hour of fake time is that rule, checked.
 */
describe('ProjectEvents', () => {
  let events: ProjectEvents;
  let opened: FakeStream[];

  beforeEach(() => {
    vi.useFakeTimers();
    opened = [];
    TestBed.configureTestingModule({
      providers: [
        {
          provide: EVENT_SOURCE_FACTORY,
          useValue: (url: string) => {
            const stream = new FakeStream(url);
            opened.push(stream);
            return stream;
          },
        },
      ],
    });
    events = TestBed.inject(ProjectEvents);
  });

  afterEach(() => {
    events.close();
    vi.useRealTimers();
  });

  const counters = (): number[] =>
    PROJECT_TOPICS.map((topic) => events.invalidations(topic as ProjectTopic)());

  it('opens one channel for the project, at the project-scoped path', () => {
    events.connect('p1');

    expect(opened).toHaveLength(1);
    expect(opened[0].url).toBe('/projects/api/projects/p1/events');
  });

  /** Project ids reach this from a URL, so one that needs escaping has to survive the trip. */
  it('escapes the id rather than pasting it into the path', () => {
    events.connect('a/b');

    expect(opened[0].url).toBe('/projects/api/projects/a%2Fb/events');
  });

  it('bumps every counter on connect', () => {
    events.connect('p1');
    expect(counters().every((count) => count === 0)).toBe(true);

    opened[0].connect();

    expect(counters()).toEqual(PROJECT_TOPICS.map(() => 1));
    expect(events.connected()).toBe(true);
  });

  it('bumps every counter again on every reconnect, because a reconnect is a connect', () => {
    events.connect('p1');
    opened[0].connect();
    opened[0].drop();

    expect(events.connected()).toBe(false);

    opened[0].connect();

    expect(counters()).toEqual(PROJECT_TOPICS.map(() => 2));
  });

  it('maps one topic frame to one invalidation and leaves every other topic alone', () => {
    events.connect('p1');
    opened[0].emit('epics');
    opened[0].emit('epics');

    expect(events.invalidations('epics')()).toBe(2);
    expect(events.invalidations('agent-activity')()).toBe(0);
  });

  it('ignores the heartbeat and any topic a newer service invents', () => {
    events.connect('p1');
    opened[0].emit('ping');
    opened[0].emit('something-that-does-not-exist-yet');

    expect(counters().every((count) => count === 0)).toBe(true);
  });

  it('moves the connection when the project changes, and not when it does not', () => {
    events.connect('p1');
    events.connect('p1');
    expect(opened).toHaveLength(1);

    events.connect('p2');

    expect(opened).toHaveLength(2);
    expect(opened[0].closed).toBe(true);
    expect(opened[1].url).toBe('/projects/api/projects/p2/events');
  });

  it('closes the stream and reports itself down', () => {
    events.connect('p1');
    opened[0].connect();

    events.close();

    expect(opened[0].closed).toBe(true);
    expect(events.connected()).toBe(false);
  });

  it('schedules nothing — the channel replaces polling rather than joining it', () => {
    events.connect('p1');
    opened[0].connect();
    opened[0].emit('epics');
    vi.advanceTimersByTime(60 * 60 * 1000);

    expect(vi.getTimerCount()).toBe(0);
  });
});
