import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideQitsNavigationTree, type QitsNavigation } from '@qits/ui-components';
import { routes } from '../app.routes';
import { EVENT_SOURCE_FACTORY, type EventSourceLike } from '../api/event-source';
import type { TicketCommentDto, TicketDto } from '../api/dto';

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

  emit(topic: string): void {
    this.onmessage?.(new MessageEvent<string>('message', { data: topic }));
  }
}

/**
 * The platform as the edge states it, with **qits-workspaces served on a host of its own**.
 *
 * <p>This page draws anchors into that application now, and `QitsAppLinks.href` answers `undefined`
 * for one the navigation tree does not place — which is an ordinary state the markup has its own
 * sentence for, and therefore one a spec can sit in without noticing. The slot is declared here so
 * the workspace assertions below are about the address that gets composed rather than about the
 * fallback. It is the same tree `tickets-overview.spec.ts` uses, for the same reason.
 */
const PLATFORM: QitsNavigation = {
  environment: 'dev',
  origin: 'https://dev.example.test',
  slots: {
    'services.details': [
      {
        app: 'qits-workspaces',
        label: 'Workspaces',
        host: 'workspaces.dev.example.test',
        origin: 'https://workspaces.dev.example.test',
      },
    ],
  },
};

const AT = '2026-09-07T09:00:00Z';

function ticket(over: Partial<TicketDto> = {}): TicketDto {
  return {
    id: 't1',
    projectId: 'p1',
    title: 'The cancelled badge is the wrong colour',
    slug: 'cancelled-badge',
    number: 41,
    qualifiedId: 'qits-41',
    type: 'BUG',
    status: 'REPORTED',
    assignee: null,
    createdBy: 'kim',
    impetus: 'The run badge shows success when a run is cancelled, on the builds page.',
    description: 'It reads as **success**.',
    createdAt: AT,
    updatedAt: AT,
    workspaces: [],
    ...over,
  };
}

function comment(over: Partial<TicketCommentDto> = {}): TicketCommentDto {
  return {
    id: 'c1',
    ticketId: 't1',
    author: 'kim',
    body: 'Reproduced on **dev**.',
    createdAt: AT,
    updatedAt: AT,
    ...over,
  };
}

/**
 * One ticket, whole — and the thing this page does that no other page here does: it resolves a
 * **slug** against the project's list, because the service's read vocabulary is ids and the URL's is
 * slugs.
 *
 * <p>That resolution is also where the page can quietly go wrong. A slug the project does not hold
 * is an ordinary not-found and must read as one; a list that has not answered yet must not be
 * mistaken for a ticket that does not exist.
 *
 * <p>The rest is the two write surfaces. The ticket's own edits send the whole form with a **clear**
 * for each box left empty, because an absent field means untouched and cannot also mean emptied.
 * The comments re-read after every write, because their order and membership are the server's.
 */
describe('TicketDetailPage', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;
  let streams: FakeStream[];

  beforeEach(() => {
    streams = [];
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideLocationMocks(),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: EVENT_SOURCE_FACTORY,
          useValue: (url: string) => {
            const stream = new FakeStream(url);
            streams.push(stream);
            return stream;
          },
        },
        provideQitsNavigationTree(PLATFORM),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  async function settle(): Promise<void> {
    for (let round = 0; round < 4; round += 1) {
      await Promise.resolve();
      await harness.fixture.whenStable();
    }
  }

  function flushProjects() {
    http.expectOne('/projects/api/projects').flush({
      entries: [{ project: { id: 'p1', name: 'qits', slug: 'p1', description: null, dns: null } }],
    });
  }

  function flushTickets(tickets: readonly TicketDto[]) {
    http
      .expectOne('/projects/api/projects/p1/tickets')
      .flush({ entries: tickets.map((value) => ({ ticket: value })) });
  }

  /**
   * The dossier's page list — normally empty, which is what makes the section absent.
   *
   * Every read of the ticket asks it, because "is there a dossier" is a question about the row and
   * not about the panel, and the panel cannot answer it before it is on screen.
   */
  function flushDossier(slugs: readonly string[] = []) {
    http.expectOne('/projects/api/tickets/t1/dossier').flush({
      pages: slugs.map((slug, index) => ({
        id: `d${index}`,
        epicId: null,
        ticketId: 't1',
        slug,
        title: 'The claim loop',
        position: index,
        body: '# The claim loop\n\nHow it turns.',
        version: 0,
        createdAt: AT,
        updatedAt: AT,
      })),
    });
  }

  function flushComments(comments: readonly TicketCommentDto[]) {
    http
      .expectOne('/projects/api/tickets/t1/comments')
      .flush({ entries: comments.map((value) => ({ comment: value })) });
  }

  /** Open the page, resolve the project, resolve the slug, and answer the thread. */
  async function openTicket(
    row: TicketDto = ticket(),
    comments: readonly TicketCommentDto[] = [comment()],
    url = '/p1/tickets/cancelled-badge',
    dossier: readonly string[] = [],
  ): Promise<void> {
    harness = await RouterTestingHarness.create(url);
    flushProjects();
    await settle();
    flushTickets([row]);
    await settle();
    flushDossier(dossier);
    await settle();
    flushComments(comments);
    await settle();
  }

  function page(): HTMLElement {
    return harness.fixture.nativeElement as HTMLElement;
  }

  function text(): string {
    return page().textContent ?? '';
  }

  function buttonNamed(label: string): HTMLButtonElement {
    const found = Array.from(page().querySelectorAll('button')).find(
      (node) => node.textContent?.trim() === label,
    );
    expect(found, `no button named “${label}”`).toBeTruthy();
    return found as HTMLButtonElement;
  }

  function buttonLabels(): string[] {
    return Array.from(page().querySelectorAll('button')).map(
      (node) => node.textContent?.trim() ?? '',
    );
  }

  /** The lifecycle row alone: the buttons between Edit and the block/delete presses. */
  function lifecycleLabels(): string[] {
    const lifecycle = new Set([
      'Mark reported',
      'Mark refined',
      'Mark implemented',
      'Mark verified',
      'Close',
      'Drop',
      'Back to reported',
      'Back to refined',
      'Back to implemented',
      'Back to done',
      'Back to dropped',
      'Reopen',
    ]);
    return buttonLabels().filter((label) => lifecycle.has(label));
  }

  async function type(selector: string, value: string): Promise<void> {
    const field = page().querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
    expect(field, `no field at “${selector}”`).toBeTruthy();
    field!.value = value;
    field!.dispatchEvent(new Event('input'));
    await settle();
  }

  describe('resolving the address', () => {
    it('finds the ticket the slug names and draws it whole', async () => {
      await openTicket(ticket({ assignee: 'kim' }));

      expect(page().querySelector('h1')?.textContent).toContain('The cancelled badge');
      expect(page().querySelector('.assignee')?.textContent).toBe('kim');
      expect(page().querySelector('.reporter')?.textContent).toBe('kim');
      expect(page().querySelector('.description strong')?.textContent).toBe('success');
      expect(text()).not.toContain('**');
      http.verify();
    });

    /**
     * The detail page is where somebody reads a ticket before writing about it, so it is where the
     * identifier has to be legible and copyable. Null is the service saying it could not resolve the
     * project, and `null-41` is worse than nothing because it looks copyable.
     */
    it('shows the qualified id beside the title, and nothing where there is none', async () => {
      await openTicket();

      expect(page().querySelector('.title-row .qualified')?.textContent?.trim()).toBe('qits-41');
    });

    it('draws no identifier at all where the service could not resolve one', async () => {
      await openTicket(ticket({ qualifiedId: null }));

      expect(page().querySelector('.title-row .qualified')).toBeNull();
      expect(page().querySelector('.title-row')?.textContent).not.toContain('null');
    });

    it('badges the type and the status', async () => {
      await openTicket();
      const badges = Array.from(page().querySelectorAll('.qits-badge')).map((node) =>
        node.textContent?.trim(),
      );

      expect(badges).toEqual(['bug', 'reported']);
    });

    /** Nothing failed — the address simply names nothing, and that reads as a not-found. */
    it('says the ticket does not exist for a slug the project does not hold', async () => {
      harness = await RouterTestingHarness.create('/p1/tickets/nope');
      flushProjects();
      await settle();
      flushTickets([ticket()]);
      await settle();

      expect(text()).toContain("Could not load the ticket — No ticket 'nope'.");
      expect(page().querySelector('h1')).toBeNull();
      // A ticket that was never resolved has no thread to ask for.
      http.verify();
    });

    it('reports a failed resolution and re-reads on retry', async () => {
      harness = await RouterTestingHarness.create('/p1/tickets/cancelled-badge');
      flushProjects();
      await settle();
      http
        .expectOne('/projects/api/projects/p1/tickets')
        .flush(null, { status: 503, statusText: 'Down' });
      await settle();

      expect(text()).toContain('Could not load the ticket — 503');

      buttonNamed('Retry').click();
      await settle();
      flushTickets([ticket()]);
      await settle();
      flushDossier();
      await settle();
      flushComments([]);
      await settle();

      expect(page().querySelector('h1')?.textContent).toContain('The cancelled badge');
    });

    it('leads back to the tickets board', async () => {
      await openTicket();

      expect(page().querySelector('.back a')?.getAttribute('href')).toBe('/p1/tickets');
    });

    /**
     * The impetus and the description are two statements by two authors — what brought the ticket
     * about, and what refining decided to do about it — so the reporter's sentence is drawn first
     * and the refinement beneath it. A page that led with the refinement would bury the only
     * sentence saying why anybody should care.
     */
    it('draws the impetus above the description, as the headline it is', async () => {
      await openTicket();
      const impetus = page().querySelector('.impetus');
      const description = page().querySelector('.description');

      expect(impetus?.textContent?.trim()).toBe(
        'The run badge shows success when a run is cancelled, on the builds page.',
      );
      expect(description).toBeTruthy();
      expect(impetus!.compareDocumentPosition(description!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    });

    /** Not refined yet is a fact about the pipeline; an empty panel would say nothing at all. */
    it('says the work has not been written yet rather than drawing an empty panel', async () => {
      await openTicket(ticket({ description: null }));

      expect(text()).toContain('Not refined yet');
      expect(page().querySelector('.impetus')).toBeTruthy();
      expect(page().querySelector('.description')).toBeNull();
    });
  });

  describe('editing it', () => {
    it('seeds the form from the row and saves the whole of it', async () => {
      await openTicket(ticket({ assignee: 'kim' }));

      buttonNamed('Edit').click();
      await settle();
      expect(page().querySelector<HTMLInputElement>('.edit-title')?.value).toBe(
        'The cancelled badge is the wrong colour',
      );
      expect(page().querySelector<HTMLInputElement>('.edit-assignee')?.value).toBe('kim');

      await type('.edit-title', 'The cancelled badge reads as success');
      buttonNamed('Save').click();
      await settle();

      const request = http.expectOne('/projects/api/tickets/t1');
      expect(request.request.method).toBe('PUT');
      expect(request.request.body).toEqual({
        title: 'The cancelled badge reads as success',
        impetus: 'The run badge shows success when a run is cancelled, on the builds page.',
        type: 'BUG',
        description: 'It reads as **success**.',
        assignee: 'kim',
      });
      request.flush({ ticket: ticket({ title: 'The cancelled badge reads as success' }) });
      await settle();

      expect(page().querySelector('h1')?.textContent).toContain('reads as success');
      expect(page().querySelector('.form')).toBeNull();
      http.verify();
    });

    /** Absence means untouched, so emptying a box has to be spelled as a clear of its own. */
    it('turns an emptied box into an explicit clear', async () => {
      await openTicket(ticket({ assignee: 'kim' }));

      buttonNamed('Edit').click();
      await settle();
      await type('.edit-description', '   ');
      await type('.edit-assignee', '');
      buttonNamed('Save').click();
      await settle();

      const request = http.expectOne('/projects/api/tickets/t1');
      expect(request.request.body).toEqual({
        title: 'The cancelled badge is the wrong colour',
        impetus: 'The run badge shows success when a run is cancelled, on the builds page.',
        type: 'BUG',
        clearDescription: true,
        clearAssignee: true,
      });
      request.flush({ ticket: ticket({ description: null, assignee: null }) });
      await settle();
    });

    it('will not save a ticket with no title left on it', async () => {
      await openTicket();

      buttonNamed('Edit').click();
      await settle();
      await type('.edit-title', '  ');

      expect(buttonNamed('Save').disabled).toBe(true);
    });

    /**
     * The correction the lifecycle is explicit about: **nothing freezes the impetus.** Triage fixing
     * a badly written one is the edit the field exists for, and the later phases are kept off it by
     * their prompt templates rather than by a guard here.
     */
    it('edits the impetus, seeded from the row and quoting the create form’s rule', async () => {
      await openTicket();

      buttonNamed('Edit').click();
      await settle();

      expect(page().querySelector<HTMLTextAreaElement>('.edit-impetus')?.value).toBe(
        'The run badge shows success when a run is cancelled, on the builds page.',
      );
      expect(text()).toContain('What brought this about, in your own words');

      await type('.edit-impetus', 'A cancelled run is badged success on the builds page.');
      buttonNamed('Save').click();
      await settle();

      const request = http.expectOne('/projects/api/tickets/t1');
      expect(request.request.body).toMatchObject({
        impetus: 'A cancelled run is badged success on the builds page.',
      });
      request.flush({
        ticket: ticket({ impetus: 'A cancelled run is badged success on the builds page.' }),
      });
      await settle();

      expect(page().querySelector('.impetus')?.textContent).toContain('is badged success');
    });

    /** The one box with no clear beside it: a ticket has to say what brought it about. */
    it('will not save a ticket with its impetus emptied', async () => {
      await openTicket();

      buttonNamed('Edit').click();
      await settle();
      await type('.edit-impetus', '   ');

      expect(buttonNamed('Save').disabled).toBe(true);
    });

    it('reports a refused save and leaves the form open with what was typed', async () => {
      await openTicket();

      buttonNamed('Edit').click();
      await settle();
      await type('.edit-title', 'Renamed');
      buttonNamed('Save').click();
      await settle();
      http
        .expectOne('/projects/api/tickets/t1')
        .flush({ message: 'the title is too long' }, { status: 400, statusText: 'Bad Request' });
      await settle();

      expect(text()).toContain('Could not save it — 400 the title is too long.');
      expect(page().querySelector<HTMLInputElement>('.edit-title')?.value).toBe('Renamed');
    });
  });

  /**
   * The transition control, which is where the lifecycle is visible.
   *
   * The rule it is drawn from is adjacency: from any status there are one or two legal moves and
   * every other target is a 409. So the row offers the neighbours and nothing else — including no
   * press that would land on the status already held — and a refusal that arrives anyway is a page
   * that was open while somebody else moved the ticket, which is the service's sentence to say.
   */
  describe('moving it along the lifecycle', () => {
    it('offers only the neighbours of the status the ticket holds', async () => {
      await openTicket();

      expect(buttonNamed('Mark refined')).toBeTruthy();
      expect(
        Array.from(page().querySelectorAll('button')).map((node) => node.textContent?.trim()),
      ).not.toContain('Mark implemented');
      expect(
        Array.from(page().querySelectorAll('button')).map((node) => node.textContent?.trim()),
      ).not.toContain('Mark reported');
    });

    it('offers both neighbours from the middle, and uses the answer directly', async () => {
      await openTicket(ticket({ status: 'IMPLEMENTED' }));

      expect(buttonNamed('Back to refined')).toBeTruthy();
      buttonNamed('Mark verified').click();
      await settle();

      const request = http.expectOne('/projects/api/tickets/t1/transition');
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({ target: 'VERIFIED' });
      request.flush({ ticket: ticket({ status: 'VERIFIED' }) });
      await settle();

      // The new status brings its own pair of neighbours with it, and nothing is re-read.
      expect(buttonNamed('Close')).toBeTruthy();
      expect(buttonNamed('Back to implemented')).toBeTruthy();
      http.verify();
    });

    /** Nothing is terminal: a closed ticket that was not fixed walks back the way it came. */
    it('offers the way back out of done, and no way further on', async () => {
      await openTicket(ticket({ status: 'DONE' }));

      buttonNamed('Reopen').click();
      await settle();

      const request = http.expectOne('/projects/api/tickets/t1/transition');
      expect(request.request.body).toEqual({ target: 'VERIFIED' });
      request.flush({ ticket: ticket({ status: 'VERIFIED' }) });
      await settle();

      expect(buttonNamed('Close')).toBeTruthy();
    });

    /**
     * A 409 is the one failure this page has nothing to add to: the button was legal when it was
     * drawn, so the conflict is news about the ticket and the service's own sentence is the news.
     */
    it('renders a stale page’s 409 as the service’s sentence, not as its own', async () => {
      await openTicket();

      buttonNamed('Mark refined').click();
      await settle();
      http
        .expectOne('/projects/api/tickets/t1/transition')
        .flush(
          { message: 'the ticket is already REFINED' },
          { status: 409, statusText: 'Conflict' },
        );
      await settle();

      expect(text()).toContain('the ticket is already REFINED');
      expect(text()).not.toContain('Could not move it');
      expect(buttonNamed('Mark refined')).toBeTruthy();
    });

    /** Anything that is not a conflict is a failed request, not a statement about the ticket. */
    it('keeps its own wrapper around a failure that is not a refusal', async () => {
      await openTicket();

      buttonNamed('Mark refined').click();
      await settle();
      http
        .expectOne('/projects/api/tickets/t1/transition')
        .flush(null, { status: 503, statusText: 'Down' });
      await settle();

      expect(text()).toContain('Could not move it — 503.');
    });

    /**
     * The exit, offered from every status that still owes something — and last in the row, because it
     * is the press that ends the ticket and must not sit where the hand reaching for the next step
     * lands.
     */
    it('offers the drop from a status still in flight, after the lifecycle moves', async () => {
      await openTicket(ticket({ status: 'IMPLEMENTED' }));

      expect(lifecycleLabels()).toEqual(['Mark verified', 'Back to refined', 'Drop']);

      buttonNamed('Drop').click();
      await settle();

      const request = http.expectOne('/projects/api/tickets/t1/transition');
      expect(request.request.body).toEqual({ target: 'DROPPED' });
      request.flush({ ticket: ticket({ status: 'DROPPED' }) });
      await settle();

      expect(lifecycleLabels()).toEqual(['Back to reported']);
    });

    /**
     * `DONE` is an ending already, so dropping it would rewrite what happened rather than decide what
     * will not — and out of `DROPPED` there is one move, landing at the beginning, because the
     * refinement went with the work.
     */
    it('offers no drop out of done', async () => {
      await openTicket(ticket({ status: 'DONE' }));

      expect(lifecycleLabels()).toEqual(['Reopen']);
    });

    it('offers only the way back to reported out of dropped', async () => {
      await openTicket(ticket({ status: 'DROPPED' }));
      expect(lifecycleLabels()).toEqual(['Back to reported']);

      buttonNamed('Back to reported').click();
      await settle();

      const request = http.expectOne('/projects/api/tickets/t1/transition');
      expect(request.request.body).toEqual({ target: 'REPORTED' });
      request.flush({ ticket: ticket({ status: 'REPORTED' }) });
      await settle();

      expect(
        Array.from(page().querySelectorAll('.title-row .qits-badge')).map((node) =>
          node.textContent?.trim(),
        ),
      ).toEqual(['bug', 'reported']);
    });
  });

  /**
   * Blocking, which is orthogonal to the lifecycle: a blocked ticket is exactly as far along as it
   * was, and what it says is that the phase behind that status cannot proceed.
   *
   * <p>So the two things worth pinning are where the press is offered at all — only where a phase
   * runs — and that a block without a reason never leaves the browser. A blocked ticket with no
   * reason is a row that stopped and does not say what it is waiting for, which is the one thing
   * anybody reading it afterwards needs.
   */
  describe('blocking it', () => {
    it.each(['REPORTED', 'REFINED', 'IMPLEMENTED'] as const)(
      'offers the block on %s, where a phase runs',
      async (status) => {
        await openTicket(ticket({ status }));

        expect(buttonNamed('Block')).toBeTruthy();
      },
    );

    it.each(['VERIFIED', 'DONE', 'DROPPED'] as const)(
      'offers neither press on %s, where no phase runs',
      async (status) => {
        await openTicket(ticket({ status }));

        expect(buttonLabels()).not.toContain('Block');
        expect(buttonLabels()).not.toContain('Unblock');
      },
    );

    /** The box opens in place and sends nothing; a blank reason leaves its submit dead. */
    it('collects the reason before sending, and refuses to send a blank one', async () => {
      await openTicket();

      buttonNamed('Block').click();
      await settle();
      http.expectNone('/projects/api/tickets/t1/blocked');
      expect(buttonNamed('Block').disabled).toBe(true);

      await type('.block-note', '   ');
      expect(buttonNamed('Block').disabled).toBe(true);
      http.expectNone('/projects/api/tickets/t1/blocked');

      await type('.block-note', 'Waiting on qits-ci to redeploy.');
      buttonNamed('Block').click();
      await settle();

      const request = http.expectOne('/projects/api/tickets/t1/blocked');
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({
        blocked: true,
        reason: 'Waiting on qits-ci to redeploy.',
      });
      request.flush({ ticket: ticket({ blocked: true }) });
      await settle();

      expect(text()).toContain('The phase behind this status cannot proceed');
      expect(buttonNamed('Unblock')).toBeTruthy();
      http.verify();
    });

    /** Coming back is self-explanatory, so the note is offered and not demanded. */
    it('unblocks without insisting on a note', async () => {
      await openTicket(ticket({ blocked: true }));

      expect(text()).toContain('The phase behind this status cannot proceed');
      buttonNamed('Unblock').click();
      await settle();
      buttonNamed('Unblock').click();
      await settle();

      const request = http.expectOne('/projects/api/tickets/t1/blocked');
      expect(request.request.body).toEqual({ blocked: false, reason: '' });
      request.flush({ ticket: ticket({ blocked: false }) });
      await settle();

      expect(text()).not.toContain('The phase behind this status cannot proceed');
      expect(buttonNamed('Block')).toBeTruthy();
    });

    /** Nothing is said about a ticket that is not blocked — a "Blocked: no" on every row says nothing. */
    it('draws no blocked fact on an unblocked ticket', async () => {
      await openTicket();

      expect(text()).not.toContain('The phase behind this status cannot proceed');
    });
  });

  describe('deleting it', () => {
    /** Throwing a record away asks in the button, not in a dialog the page cannot style or test. */
    it('asks once, and sends nothing until it is answered', async () => {
      await openTicket();

      buttonNamed('Delete').click();
      await settle();
      http.expectNone('/projects/api/tickets/t1');

      buttonNamed('Confirm delete?').click();
      await settle();

      const request = http.expectOne('/projects/api/tickets/t1');
      expect(request.request.method).toBe('DELETE');
      request.flush({ success: true });
      await settle();

      // The subject is gone, so staying here would draw a not-found where the reader was working.
      expect(TestBed.inject(Router).url).toBe('/p1/tickets');
      http.expectOne('/projects/api/projects/p1/tickets').flush({ entries: [] });
      await settle();
    });

    it('stays put and says why when the delete is refused', async () => {
      await openTicket();

      buttonNamed('Delete').click();
      await settle();
      buttonNamed('Confirm delete?').click();
      await settle();
      http
        .expectOne('/projects/api/tickets/t1')
        .flush({ message: 'not yours to delete' }, { status: 403, statusText: 'Forbidden' });
      await settle();

      expect(text()).toContain('Could not delete it — 403 not yours to delete.');
      expect(TestBed.inject(Router).url).toBe('/p1/tickets/cancelled-badge');
    });
  });

  describe('the comments', () => {
    it('draws the thread oldest first, with the author and how long ago', async () => {
      await openTicket(ticket(), [
        comment({ id: 'c1', body: 'First.' }),
        comment({ id: 'c2', author: null, body: 'Second.' }),
      ]);
      const authors = Array.from(page().querySelectorAll('.author')).map((node) =>
        node.textContent?.trim(),
      );
      const bodies = Array.from(page().querySelectorAll('.comment > app-markdown')).map((node) =>
        node.textContent?.trim(),
      );

      expect(bodies).toEqual(['First.', 'Second.']);
      // A comment with no principal behind it draws the dash, not an empty byline.
      expect(authors).toEqual(['kim', '—']);
      expect(page().querySelector('.age')?.textContent).toBeTruthy();
    });

    it('renders a comment body as the markdown it is written in', async () => {
      await openTicket();

      expect(page().querySelector('.comment .body strong')?.textContent).toBe('dev');
    });

    /** There is no `edited` flag on the wire, so the two timestamps are the whole of the evidence. */
    it('says a comment was edited once its update has moved past its creation', async () => {
      await openTicket(ticket(), [
        comment({ id: 'c1' }),
        comment({ id: 'c2', updatedAt: '2026-09-07T11:00:00Z' }),
      ]);
      const rows = Array.from(page().querySelectorAll('.comment'));

      expect(rows[0].querySelector('.edited')).toBeNull();
      expect(rows[1].querySelector('.edited')?.textContent).toContain('edited');
    });

    it('says nothing has been said rather than drawing an empty list', async () => {
      await openTicket(ticket(), []);

      expect(text()).toContain('Nothing has been said about this ticket yet.');
    });

    it('posts only the body, then re-reads the thread', async () => {
      await openTicket(ticket(), []);

      expect(buttonNamed('Comment').disabled).toBe(true);
      await type('.compose', 'Reproduced on dev.');
      expect(buttonNamed('Comment').disabled).toBe(false);

      buttonNamed('Comment').click();
      await settle();

      const request = http.expectOne('/projects/api/tickets/t1/comments');
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({ body: 'Reproduced on dev.' });
      request.flush({ comment: comment({ body: 'Reproduced on dev.' }) });
      await settle();

      // The order and the membership are the server's, so the answer is not spliced in.
      flushComments([comment({ body: 'Reproduced on dev.' })]);
      await settle();

      expect(page().querySelector('.comment .body')?.textContent).toContain('Reproduced on dev.');
      expect(page().querySelector<HTMLTextAreaElement>('.compose')?.value).toBe('');
    });

    it('edits one comment at its own address, then re-reads', async () => {
      await openTicket();

      buttonNamed('Edit').click();
      await settle();
      // The ticket's own Edit is the first; the comment's is the one inside the thread.
      const commentEdit = page().querySelector<HTMLButtonElement>('.comment button');
      expect(page().querySelector('.comment-edit')).toBeNull();
      buttonNamed('Cancel').click();
      await settle();
      commentEdit!.click();
      await settle();

      expect(page().querySelector<HTMLTextAreaElement>('.comment-edit')?.value).toBe(
        'Reproduced on **dev**.',
      );
      await type('.comment-edit', 'Reproduced on dev and on stage.');
      buttonNamed('Save').click();
      await settle();

      const request = http.expectOne('/projects/api/ticket-comments/c1');
      expect(request.request.method).toBe('PUT');
      expect(request.request.body).toEqual({ body: 'Reproduced on dev and on stage.' });
      request.flush({ comment: comment({ body: 'Reproduced on dev and on stage.' }) });
      await settle();

      flushComments([comment({ body: 'Reproduced on dev and on stage.' })]);
      await settle();

      expect(text()).toContain('Reproduced on dev and on stage.');
    });

    it('deletes one comment and re-reads the thread', async () => {
      await openTicket();

      const buttons = Array.from(page().querySelectorAll<HTMLButtonElement>('.comment button'));
      buttons[1].click();
      await settle();

      const request = http.expectOne('/projects/api/ticket-comments/c1');
      expect(request.request.method).toBe('DELETE');
      request.flush({ success: true });
      await settle();

      flushComments([]);
      await settle();

      expect(text()).toContain('Nothing has been said about this ticket yet.');
    });

    /**
     * The two states fail independently and only one of them is the page: a thread that could not be
     * read must not replace the ticket with an error about a list.
     */
    it('keeps the ticket on screen when only the comments could not be read', async () => {
      harness = await RouterTestingHarness.create('/p1/tickets/cancelled-badge');
      flushProjects();
      await settle();
      flushTickets([ticket()]);
      await settle();
      flushDossier();
      await settle();
      http
        .expectOne('/projects/api/tickets/t1/comments')
        .flush(null, { status: 503, statusText: 'Down' });
      await settle();

      expect(page().querySelector('h1')?.textContent).toContain('The cancelled badge');
      expect(text()).toContain('Could not load the comments — 503');
    });
  });

  /**
   * The refine phase's other output.
   *
   * What to do about a ticket normally goes in `description`; where the situation is too tangled for
   * prose it goes into dossier pages instead, written over MCP, and this is where they are read. The
   * claim worth guarding is the **absence**: almost no ticket has a dossier, and an empty "Dossier"
   * heading on every one of them would be a promise about a feature they do not use.
   */
  describe('the dossier', () => {
    it('draws no section at all on a ticket with no pages', async () => {
      await openTicket();

      expect(page().querySelector('.dossier-section')).toBeNull();
      expect(text()).not.toContain('Dossier');
      http.verify();
    });

    it('draws the pages refining wrote, through the epic panel with a ticket owner', async () => {
      await openTicket(ticket(), [comment()], '/p1/tickets/cancelled-badge', ['the-claim-loop']);
      // The panel reads the list itself once it is on screen — see the page's class note.
      flushDossier(['the-claim-loop']);
      await settle();

      expect(page().querySelector('.dossier-section')).toBeTruthy();
      expect(page().querySelector('.dossier .rendered')?.innerHTML).toContain('How it turns.');
    });

    /** No assets under a ticket, so the affordance that would 404 is not drawn. */
    it('offers no figure insertion on a ticket-owned page', async () => {
      await openTicket(ticket(), [comment()], '/p1/tickets/cancelled-badge', ['the-claim-loop']);
      flushDossier(['the-claim-loop']);
      await settle();

      const labels = Array.from(page().querySelectorAll('button')).map((node) =>
        node.textContent?.trim(),
      );
      expect(labels).not.toContain('from Sketch');
      expect(labels).not.toContain('from Design');
    });
  });

  /**
   * Where the ticket's work happened.
   *
   * <p>The chain a reader follows is ticket → the workspace → its sessions → the conversation, and
   * it used to break at the first hop the moment the workspace was integrated. The service reports
   * the resolved ones now, so the claims worth guarding are that the link **survives resolution**,
   * that it is drawn as the record it is rather than as a chat that no longer exists, and that a
   * ticket nobody ever dispatched an agent onto still draws nothing at all.
   */
  describe('the workspaces on it', () => {
    const ON_IT = {
      workspaceRowId: 41,
      repositoryId: 'r1',
      workspaceId: 'ticket-cancelled-badge',
      branch: 'ticket/cancelled-badge',
    };

    function workspaceLinks(): HTMLAnchorElement[] {
      return Array.from(page().querySelectorAll('.workspaces-section a.workspace'));
    }

    it('links a live workspace to its chat', async () => {
      await openTicket(ticket({ workspaces: [ON_IT] }));

      expect(page().querySelector('.workspaces-section')).toBeTruthy();
      expect(workspaceLinks()).toHaveLength(1);
      expect(workspaceLinks()[0].getAttribute('href')).toBe(
        'https://workspaces.dev.example.test/repositories/r1/workspaces/41?tab=chat',
      );
      expect(workspaceLinks()[0].textContent?.trim()).toBe('Open ticket/cancelled-badge');
    });

    /**
     * The point of the whole change: an integrated workspace is still linked, said to be resolved,
     * and addressed without the chat tab — the resolved page renders no tabs at all.
     */
    it('keeps an integrated workspace, as a record rather than as a chat', async () => {
      await openTicket(ticket({ workspaces: [{ ...ON_IT, status: 'INTEGRATED' }] }));

      expect(workspaceLinks()[0].getAttribute('href')).toBe(
        'https://workspaces.dev.example.test/repositories/r1/workspaces/41',
      );
      expect(workspaceLinks()[0].textContent?.trim()).toBe(
        'Open ticket/cancelled-badge (integrated)',
      );
    });

    it('keeps an abandoned one the same way', async () => {
      await openTicket(ticket({ workspaces: [{ ...ON_IT, status: 'ABANDONED' }] }));

      expect(workspaceLinks()[0].getAttribute('href')).not.toContain('tab=chat');
      expect(workspaceLinks()[0].textContent?.trim()).toBe(
        'Open ticket/cancelled-badge (abandoned)',
      );
    });

    it('draws live and resolved together when the ticket has been round twice', async () => {
      await openTicket(
        ticket({
          workspaces: [
            { ...ON_IT, status: 'ABANDONED' },
            { ...ON_IT, workspaceRowId: 42, branch: 'ticket/cancelled-badge-again' },
          ],
        }),
      );

      expect(workspaceLinks().map((node) => node.textContent?.trim())).toEqual([
        'Open ticket/cancelled-badge (abandoned)',
        'Open ticket/cancelled-badge-again',
      ]);
    });

    /** Most tickets never had an agent on them; a "Workspaces" heading on all of them says nothing. */
    it('draws no section at all on a ticket nobody was ever dispatched onto', async () => {
      await openTicket();

      expect(page().querySelector('.workspaces-section')).toBeNull();
      expect(text()).not.toContain('Workspaces');
      http.verify();
    });

    /** It belongs to the reading view; editing the ticket is not the moment to follow a link out. */
    it('is not drawn while the ticket is being edited', async () => {
      await openTicket(ticket({ workspaces: [ON_IT] }));

      buttonNamed('Edit').click();
      await settle();

      expect(page().querySelector('.workspaces-section')).toBeNull();
    });
  });

  /**
   * Somebody else may be commenting on the ticket being read, so the page listens on the project's
   * `tickets` topic — and the refresh has to be quiet, or a busy conversation would blank the page
   * once per remark.
   */
  describe('live updates', () => {
    it('re-reads both halves on a hint, without showing the loading state', async () => {
      await openTicket();

      streams[0].emit('tickets');
      await settle();

      expect(page().querySelector('.async-loading')).toBeNull();
      expect(page().querySelector('h1')?.textContent).toContain('The cancelled badge');

      flushTickets([ticket({ title: 'Renamed by somebody else' })]);
      await settle();
      flushDossier();
      await settle();
      flushComments([comment(), comment({ id: 'c2', body: 'And again.' })]);
      await settle();

      expect(page().querySelector('h1')?.textContent).toContain('Renamed by somebody else');
      expect(page().querySelectorAll('.comment')).toHaveLength(2);
    });

    it('asks for nothing on another panel’s topic', async () => {
      await openTicket();

      streams[0].emit('epics');
      streams[0].emit('ping');
      await settle();

      http.expectNone('/projects/api/projects/p1/tickets');
    });

    /** A hint's read that failed leaves the page a moment old, which is what it already was. */
    it('keeps the ticket standing when a hint’s re-read fails', async () => {
      await openTicket();

      streams[0].emit('tickets');
      await settle();
      http
        .expectOne('/projects/api/projects/p1/tickets')
        .flush(null, { status: 503, statusText: 'Down' });
      await settle();

      expect(page().querySelector('h1')?.textContent).toContain('The cancelled badge');
      expect(text()).not.toContain('Could not load the ticket');
    });
  });
});
