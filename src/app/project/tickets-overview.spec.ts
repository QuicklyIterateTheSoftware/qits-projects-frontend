import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { TicketDto } from '../api/dto';
import { EVENT_SOURCE_FACTORY, type EventSourceLike } from '../api/event-source';
import { TicketsOverview } from './tickets-overview';

/** The project's live channel, with every lifecycle moment turned into a method call. */
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

const AT = '2026-09-07T09:00:00Z';

function ticket(id: string, over: Partial<TicketDto> = {}): TicketDto {
  return {
    id,
    projectId: 'p1',
    title: `Ticket ${id}`,
    slug: `ticket-${id}`,
    type: 'BUG',
    status: 'OPEN',
    assignee: null,
    createdBy: null,
    description: null,
    createdAt: AT,
    updatedAt: AT,
    ...over,
  };
}

/**
 * The overview reads once and draws twice, and the two things worth pinning are what it does between
 * reads: the split into sections, and the *quiet* refresh a hint provokes.
 *
 * A hint fires whenever anybody touches a ticket or a comment anywhere in the project, so a panel
 * that blanked itself for each one would flash through a busy afternoon and would claim not to know
 * a list it is still holding.
 */
describe('TicketsOverview', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<TicketsOverview>;
  let streams: FakeStream[];

  beforeEach(() => {
    streams = [];
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: EVENT_SOURCE_FACTORY,
          useValue: (url: string) => {
            const stream = new FakeStream(url);
            streams.push(stream);
            return stream;
          },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  async function mount(projectId = 'p1', projectSlug = 'qits'): Promise<void> {
    fixture = TestBed.createComponent(TicketsOverview);
    fixture.componentRef.setInput('projectId', projectId);
    fixture.componentRef.setInput('projectSlug', projectSlug);
    await settle();
  }

  async function settle(): Promise<void> {
    for (let round = 0; round < 4; round += 1) {
      await Promise.resolve();
      await fixture.whenStable();
    }
  }

  async function flushTickets(tickets: readonly TicketDto[], projectId = 'p1'): Promise<void> {
    http
      .expectOne(`/projects/api/projects/${projectId}/tickets`)
      .flush({ entries: tickets.map((value) => ({ ticket: value })) });
    await settle();
  }

  function element(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function text(): string {
    return element().textContent ?? '';
  }

  function badges(): string[] {
    return Array.from(element().querySelectorAll('.qits-badge')).map(
      (node) => node.textContent?.trim() ?? '',
    );
  }

  /** Every card title, in the order the Open section draws them. */
  function cardTitles(): string[] {
    return Array.from(element().querySelectorAll('app-ticket-card .title')).map(
      (node) => node.textContent?.trim() ?? '',
    );
  }

  function rowTitles(): string[] {
    return Array.from(element().querySelectorAll('app-ticket-summary-row .title')).map(
      (node) => node.textContent?.trim() ?? '',
    );
  }

  /** A project with one of each, so the whole grouped screen is on at once. */
  async function loadBoth(): Promise<void> {
    await mount();
    await flushTickets([
      ticket('a', { createdAt: '2026-09-01T09:00:00Z', description: 'A public **status page**.' }),
      ticket('b', { createdAt: '2026-09-05T09:00:00Z', type: 'IMPROVEMENT', assignee: 'kim' }),
      ticket('c', { status: 'RESOLVED' }),
    ]);
  }

  it('draws the open tickets as cards, newest first', async () => {
    await loadBoth();

    expect(cardTitles()).toEqual(['Ticket b', 'Ticket a']);
  });

  it('badges each open card with its type and its status', async () => {
    await mount();
    await flushTickets([ticket('a')]);

    expect(badges()).toEqual(['bug', 'open']);
    expect(element().querySelector('.qits-badge')?.className).toContain('qits-badge-danger');
  });

  /** The dash is a fact: a ticket nobody has taken must not look like a card drawn wrong. */
  it('draws the assignee, and a dash where there is none', async () => {
    await loadBoth();
    const assignees = Array.from(element().querySelectorAll('app-ticket-card .assignee')).map(
      (node) => node.textContent?.trim(),
    );

    expect(assignees).toEqual(['kim', '—']);
  });

  it('renders a ticket’s description as the markdown it is written in', async () => {
    await loadBoth();
    // Addressed through the card's own anchor, which is also what an in-page link points at.
    const card = element().querySelector('#ticket-a app-ticket-card');

    expect(card?.querySelector('.description strong')?.textContent).toBe('status page');
    expect(card?.textContent).not.toContain('**');
  });

  it('links each card at the ticket’s own address, spelled with both slugs', async () => {
    await loadBoth();

    expect(element().querySelector('app-ticket-card .title')?.getAttribute('href')).toBe(
      '/qits/tickets/ticket-b',
    );
  });

  /** The archive is a scannable list, and it opens closed so it cannot bury the work above it. */
  it('draws the resolved tickets as collapsed rows, not as cards', async () => {
    await loadBoth();

    expect(rowTitles()).toEqual(['Ticket c']);
    const disclosure = element().querySelector('details');
    expect(disclosure?.open).toBe(false);
    expect(element().querySelector('summary')?.textContent).toContain('Resolved (1)');
  });

  it('leaves the resolved section out of a project that has resolved nothing', async () => {
    await mount();
    await flushTickets([ticket('a')]);

    expect(element().querySelector('details')).toBeNull();
  });

  /** An empty section is a fact, not blank space — and it is a different fact from having none. */
  it('says the open section is empty rather than drawing nothing', async () => {
    await mount();
    await flushTickets([ticket('c', { status: 'RESOLVED' })]);

    expect(text()).toContain('No ticket is open.');
    expect(text()).not.toContain('This project has no tickets yet.');
  });

  it('says so plainly when the project has no tickets at all', async () => {
    await mount();
    await flushTickets([]);

    expect(text()).toContain('This project has no tickets yet.');
    expect(element().querySelector('app-ticket-card')).toBeNull();
    expect(element().querySelector('.group')).toBeNull();
  });

  it('reports a failure and re-reads on retry', async () => {
    await mount();
    http
      .expectOne('/projects/api/projects/p1/tickets')
      .flush(null, { status: 503, statusText: 'Down' });
    await settle();

    expect(text()).toContain('Could not load the tickets — 503');

    element().querySelector('button')?.click();
    await settle();

    await flushTickets([ticket('a')]);
    expect(cardTitles()).toEqual(['Ticket a']);
  });

  /** The instance is re-used across a project hop, so the read has to follow the input. */
  it('re-reads when the page moves to another project', async () => {
    await loadBoth();

    fixture.componentRef.setInput('projectId', 'p2');
    await settle();
    await flushTickets([ticket('z')], 'p2');

    expect(cardTitles()).toEqual(['Ticket z']);
    expect(text()).not.toContain('Ticket a');
  });

  describe('live updates', () => {
    it('opens one channel for the project it is showing', async () => {
      await loadBoth();

      expect(streams.map((stream) => stream.url)).toEqual(['/projects/api/projects/p1/events']);
    });

    it('re-reads on a tickets hint and never shows the loading state while it does', async () => {
      await loadBoth();

      streams[0].emit('tickets');
      await settle();

      // The old list is still on screen while the new one arrives: no blank, no flash.
      expect(element().querySelector('.async-loading')).toBeNull();
      expect(cardTitles()).toEqual(['Ticket b', 'Ticket a']);

      await flushTickets([ticket('a'), ticket('b'), ticket('d')]);

      expect(cardTitles()).toContain('Ticket d');
    });

    /** No replay protocol exists, so a reconnect has to assume it missed everything. */
    it('re-reads on a connect, because the gap it closes is one it cannot see', async () => {
      await loadBoth();

      streams[0].connect();
      await settle();
      await flushTickets([ticket('z')]);

      expect(cardTitles()).toEqual(['Ticket z']);
    });

    it('asks for nothing on the heartbeat, on another panel’s topic, or on one it never heard of', async () => {
      await loadBoth();

      streams[0].emit('ping');
      streams[0].emit('epics');
      streams[0].emit('agent-activity');
      streams[0].emit('a-topic-from-a-newer-service');
      await settle();

      http.expectNone('/projects/api/projects/p1/tickets');
    });

    it('moves the channel to the new project when the page hops', async () => {
      await loadBoth();

      fixture.componentRef.setInput('projectId', 'p2');
      await settle();
      await flushTickets([ticket('z')], 'p2');

      expect(streams.map((stream) => stream.url)).toEqual([
        '/projects/api/projects/p1/events',
        '/projects/api/projects/p2/events',
      ]);
      expect(streams[0].closed).toBe(true);
    });

    /** A hint's read that failed leaves the panel a moment old, which is what it already was. */
    it('keeps the list standing when a hint’s re-read fails', async () => {
      await loadBoth();

      streams[0].emit('tickets');
      await settle();
      http
        .expectOne('/projects/api/projects/p1/tickets')
        .flush(null, { status: 503, statusText: 'Down' });
      await settle();

      expect(cardTitles()).toEqual(['Ticket b', 'Ticket a']);
      expect(text()).not.toContain('Could not load the tickets');
    });

    /** Only the hint's read is forgiving. A read the page asked for still says what happened. */
    it('still blanks and reports a failure on a read the page asked for', async () => {
      await loadBoth();

      fixture.componentRef.setInput('projectId', 'p2');
      await settle();
      http
        .expectOne('/projects/api/projects/p2/tickets')
        .flush(null, { status: 503, statusText: 'Down' });
      await settle();

      expect(text()).toContain('Could not load the tickets — 503');
      expect(element().querySelector('app-ticket-card')).toBeNull();
    });

    it('says it is behind only once it has been current', async () => {
      await loadBoth();
      expect(element().querySelector('.behind')).toBeNull();

      // A channel that never came up is not something the reader can be behind.
      streams[0].drop();
      await settle();
      expect(element().querySelector('.behind')).toBeNull();

      streams[0].connect();
      await settle();
      await flushTickets([ticket('a')]);
      expect(element().querySelector('.behind')).toBeNull();

      streams[0].drop();
      await settle();

      expect(element().querySelector('.behind')?.textContent).toContain('briefly behind');
      // The list itself stays exactly where it was.
      expect(cardTitles()).toEqual(['Ticket a']);
    });
  });
});
