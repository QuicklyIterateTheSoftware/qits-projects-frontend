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
 * A stream that never says anything. jsdom has no `EventSource` at all, and the epics overview
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
 * The epics board at its own address: the plan, the agent that drafts it, and the way back up.
 *
 * <p>This is what `/<slug>` used to render. The tests are the ones that page carried about its
 * epics, moved down with them — including the read it must *not* make: the refinement agent is the
 * rule with the largest bill, a container being an image pull and a repository clone, so the panel
 * is closed and silent until it is asked for.
 *
 * <p>The one read is the epics, and the overview owns it. It is keyed on the project **id**, which
 * the address does not carry — it names the slug — so nothing is asked for until the shared project
 * list has resolved the first segment. That is why every test flushes the list and settles before
 * answering anything else, and it is what the two failure cases at the bottom pin: an unresolved
 * address costs no request at all.
 */
describe('EpicsPage', () => {
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

  async function open(url = '/p1/epics'): Promise<void> {
    harness = await RouterTestingHarness.create(url);
  }

  /**
   * Open the page and answer the project list, which is what turns the address's slug into the id
   * the epics read is keyed on. Nothing else can be flushed before this has settled.
   */
  async function openResolved(
    projects: readonly { id: string; name: string; slug?: string }[] = [{ id: 'p1', name: 'qits' }],
    url = '/p1/epics',
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

  /** The epics are the page's only read; every test that resolves the project has to answer it. */
  function flushEpics(projectId = 'p1') {
    http.expectOne(`/projects/api/projects/${projectId}/epics`).flush({ entries: [] });
  }

  function page(): HTMLElement {
    return harness.fixture.nativeElement as HTMLElement;
  }

  it('is named for what it holds, and reads the epics and nothing else', async () => {
    await openResolved();
    flushEpics();
    await settle();

    expect(page().querySelector('h1')?.textContent).toContain('Epics');
    http.verify();
  });

  /**
   * The panel is on the page and has cost nothing. `http.verify()` above already proves the second
   * half; this states the first, so that a panel accidentally made eager fails here by name rather
   * than as an unexpected request in an unrelated test.
   */
  it('offers the refinement agent closed, having asked nothing about it', async () => {
    await openResolved();
    flushEpics();
    await settle();

    const toggle = page().querySelector<HTMLButtonElement>('button.toggle');
    expect(toggle?.textContent).toContain('Refinement agent');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(page().textContent).toContain('Not started');
    http.verify();
  });

  it('says the project has no epics rather than leaving the section blank', async () => {
    await openResolved();
    flushEpics();
    await settle();

    expect(page().textContent).toContain('This project has no epics yet.');
  });

  /** The way back up is the project node itself, which is the hub this page hangs under. */
  it('leads back to the project, named as the project', async () => {
    await openResolved();
    flushEpics();
    await settle();

    const back = page().querySelector<HTMLAnchorElement>('.back a');
    expect(back?.textContent).toContain('qits');
    expect(back?.getAttribute('href')).toBe('/p1');
  });

  it('goes to the project hub when the way back is followed', async () => {
    await openResolved();
    flushEpics();
    await settle();

    page().querySelector<HTMLAnchorElement>('.back a')?.click();
    await settle();

    expect(TestBed.inject(Router).url).toBe('/p1');
    // The hub reads nothing at all, which is what makes this assertion safe to end on.
    http.verify();
  });

  /**
   * A list that never answered leaves the page with an address and no id, so it asks for nothing —
   * and still names itself and offers the way back.
   */
  it('falls back to the address when the project list could not be read', async () => {
    await open();
    http.expectOne('/projects/api/projects').flush(null, { status: 503, statusText: 'Down' });
    await settle();

    expect(page().querySelector('.back a')?.textContent).toContain('p1');
    expect(page().querySelector('h1')?.textContent).toContain('Epics');
    http.verify();
  });

  /**
   * An address spelling the project **id** is corrected in place rather than served, and the rest of
   * the path travels with it — which is what keeps a link made before this segment existed working.
   */
  it('redirects an id in the first segment to the slug, keeping the epics segment', async () => {
    await openResolved([{ id: 'p1', name: 'qits', slug: 'qits' }]);
    flushEpics();
    await settle();

    expect(TestBed.inject(Router).url).toBe('/qits/epics');
    expect(page().querySelector('.back a')?.getAttribute('href')).toBe('/qits');
  });
});
