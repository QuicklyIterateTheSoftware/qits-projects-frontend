import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideQitsNavigationTree } from '@qits/ui-components';
import { routes } from '../app.routes';
import { EVENT_SOURCE_FACTORY, type EventSourceFactory } from '../api/event-source';

/**
 * A stream that never says anything. jsdom has no `EventSource` at all, and the tickets overview
 * opens one — a spec about anything else only needs the channel to exist.
 */
const SILENT: EventSourceFactory = () => ({
  onopen: null,
  onmessage: null,
  onerror: null,
  // Nothing to close: nothing was ever opened.
  close: () => undefined,
});

/**
 * The tickets board at its own address: the list, the way back up, and the form that opens one.
 *
 * <p>The one read is the tickets, and the overview owns it. It is keyed on the project **id**, which
 * the address does not carry — it names the slug — so nothing is asked for until the shared project
 * list has resolved the first segment. That is why every test flushes the list and settles before
 * answering anything else.
 *
 * <p>The form is the page's own, and the two rules worth pinning are the ones a reader would only
 * notice by being annoyed: it costs nothing until it is asked for, and an empty optional box is left
 * off the request rather than sent as an empty string.
 */
describe('TicketsPage', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideLocationMocks(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: EVENT_SOURCE_FACTORY, useValue: SILENT },
        provideQitsNavigationTree({ environment: 'dev', origin: 'https://dev.example.test' }),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  async function open(url = '/p1/tickets'): Promise<void> {
    harness = await RouterTestingHarness.create(url);
  }

  async function openResolved(
    projects: readonly { id: string; name: string; slug?: string }[] = [{ id: 'p1', name: 'qits' }],
    url = '/p1/tickets',
  ): Promise<void> {
    await open(url);
    flushProjects(projects);
    await settle();
  }

  async function settle(): Promise<void> {
    for (let round = 0; round < 4; round += 1) {
      await Promise.resolve();
      await harness.fixture.whenStable();
    }
  }

  function flushProjects(projects: readonly { id: string; name: string; slug?: string }[]) {
    http.expectOne('/projects/api/projects').flush({
      entries: projects.map((project) => ({
        project: {
          id: project.id,
          name: project.name,
          slug: project.slug ?? project.id,
          description: null,
          dns: null,
        },
      })),
    });
  }

  /** The tickets are the page's only read; every test that resolves the project has to answer it. */
  function flushTickets(projectId = 'p1') {
    http.expectOne(`/projects/api/projects/${projectId}/tickets`).flush({ entries: [] });
  }

  function page(): HTMLElement {
    return harness.fixture.nativeElement as HTMLElement;
  }

  function buttonNamed(label: string): HTMLButtonElement {
    const found = Array.from(page().querySelectorAll('button')).find(
      (node) => node.textContent?.trim() === label,
    );
    expect(found, `no button named “${label}”`).toBeTruthy();
    return found as HTMLButtonElement;
  }

  async function type(selector: string, value: string): Promise<void> {
    const field = page().querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
    expect(field, `no field at “${selector}”`).toBeTruthy();
    field!.value = value;
    field!.dispatchEvent(new Event('input'));
    await settle();
  }

  it('is named for what it holds, and reads the tickets and nothing else', async () => {
    await openResolved();
    flushTickets();
    await settle();

    expect(page().querySelector('h1')?.textContent).toContain('Tickets');
    http.verify();
  });

  /**
   * The triage agent is on the page and has cost nothing. `http.verify()` in the test above already
   * proves the second half; this states the first, so that a panel accidentally made eager fails here
   * by name rather than as an unexpected request in an unrelated test. It also pins *which* desk this
   * page mounts — the epics page's panel is the same component, and a missing `desk` would put a
   * conversation about the plan at the head of the tickets board.
   */
  it('offers the triage agent closed, having asked nothing about it', async () => {
    await openResolved();
    flushTickets();
    await settle();

    const toggle = page().querySelector<HTMLButtonElement>('button.toggle');
    expect(toggle?.textContent).toContain('Triage agent');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(page().textContent).not.toContain('Refinement agent');
    expect(page().textContent).toContain('Not started');
    http.verify();
  });

  it('says the project has no tickets rather than leaving the section blank', async () => {
    await openResolved();
    flushTickets();
    await settle();

    expect(page().textContent).toContain('This project has no tickets yet.');
  });

  /** The way back up is the project node itself, which is the hub this page hangs under. */
  it('leads back to the project, named as the project', async () => {
    await openResolved();
    flushTickets();
    await settle();

    const back = page().querySelector<HTMLAnchorElement>('.back a');
    expect(back?.textContent).toContain('qits');
    expect(back?.getAttribute('href')).toBe('/p1');
  });

  describe('opening a ticket', () => {
    /** A reader arrives to find a ticket, not to file one, so the form is not in the way. */
    it('keeps the form closed until it is asked for', async () => {
      await openResolved();
      flushTickets();
      await settle();

      expect(page().querySelector('.form')).toBeNull();

      buttonNamed('New ticket').click();
      await settle();

      expect(page().querySelector('.form')).not.toBeNull();
      expect(page().querySelector<HTMLSelectElement>('.select')?.value).toBe('BUG');
      // Opening a form is not a read.
      http.verify();
    });

    it('will not submit without a title', async () => {
      await openResolved();
      flushTickets();
      await settle();
      buttonNamed('New ticket').click();
      await settle();

      expect(buttonNamed('Open the ticket').disabled).toBe(true);

      await type('input.text', 'The cancelled badge is the wrong colour');

      expect(buttonNamed('Open the ticket').disabled).toBe(false);
    });

    it('posts the whole form and then hands the re-read back to the overview', async () => {
      await openResolved();
      flushTickets();
      await settle();
      buttonNamed('New ticket').click();
      await settle();

      await type('input.text', 'The cancelled badge is the wrong colour');
      await type('textarea', 'It reads as **success**.');
      await type('.field:last-of-type input.text', 'kim');
      const select = page().querySelector<HTMLSelectElement>('.select')!;
      select.value = 'IMPROVEMENT';
      select.dispatchEvent(new Event('change'));
      await settle();

      buttonNamed('Open the ticket').click();
      await settle();

      const request = http.expectOne('/projects/api/projects/p1/tickets');
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({
        title: 'The cancelled badge is the wrong colour',
        type: 'IMPROVEMENT',
        description: 'It reads as **success**.',
        assignee: 'kim',
      });
      request.flush({ ticket: {} }, { status: 201, statusText: 'Created' });
      await settle();

      // The answer is not spliced in — the overview reads the project's tickets again.
      http.expectOne('/projects/api/projects/p1/tickets').flush({ entries: [] });
      await settle();
      expect(page().querySelector('.form')).toBeNull();
    });

    /** Absence is what says "nothing was said"; an empty string would be a stored empty string. */
    it('leaves an untouched description and assignee off the request entirely', async () => {
      await openResolved();
      flushTickets();
      await settle();
      buttonNamed('New ticket').click();
      await settle();

      await type('input.text', 'Tidy the spacing');
      buttonNamed('Open the ticket').click();
      await settle();

      const request = http.expectOne('/projects/api/projects/p1/tickets');
      expect(request.request.body).toEqual({ title: 'Tidy the spacing', type: 'BUG' });
      request.flush({ ticket: {} });
      await settle();
      http.expectOne('/projects/api/projects/p1/tickets').flush({ entries: [] });
      await settle();
    });

    /** The words are the reader's, and the failure is usually transient. */
    it('reports a refused create and keeps every box as it was', async () => {
      await openResolved();
      flushTickets();
      await settle();
      buttonNamed('New ticket').click();
      await settle();

      await type('input.text', 'Tidy the spacing');
      buttonNamed('Open the ticket').click();
      await settle();
      http
        .expectOne('/projects/api/projects/p1/tickets')
        .flush({ message: 'a title is required' }, { status: 400, statusText: 'Bad Request' });
      await settle();

      expect(page().textContent).toContain('Could not open it — 400 a title is required.');
      expect(page().querySelector<HTMLInputElement>('input.text')?.value).toBe('Tidy the spacing');
      http.verify();
    });

    /** Cancelling is not a draft: the form goes away and takes what was typed with it. */
    it('clears the form when it is cancelled', async () => {
      await openResolved();
      flushTickets();
      await settle();
      buttonNamed('New ticket').click();
      await settle();
      await type('input.text', 'Half a thought');

      buttonNamed('Cancel').click();
      await settle();
      buttonNamed('New ticket').click();
      await settle();

      expect(page().querySelector<HTMLInputElement>('input.text')?.value).toBe('');
    });
  });

  /**
   * An address spelling the project **id** is corrected in place rather than served, and the rest of
   * the path travels with it.
   */
  it('redirects an id in the first segment to the slug, keeping the tickets segment', async () => {
    await openResolved([{ id: 'p1', name: 'qits', slug: 'qits' }]);
    flushTickets();
    await settle();

    expect(TestBed.inject(Router).url).toBe('/qits/tickets');
    expect(page().querySelector('.back a')?.getAttribute('href')).toBe('/qits');
  });
});
