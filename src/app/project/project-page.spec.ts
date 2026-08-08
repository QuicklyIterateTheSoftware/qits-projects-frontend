import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
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
 * The project's own address: its name, the way in to setting it up, the refinement agent, and its
 * epics.
 *
 * The reads worth pinning are the ones it does **not** make. The components read that used to
 * happen here moved behind `project-setup`, and a page that quietly kept making it would pay for a
 * screen nobody is looking at. The refinement agent is the same rule with a much larger bill: a
 * container is an image pull and a repository clone, so the panel is closed and silent until it is
 * asked for. The epics are the page's only request, and the overview owns it.
 */
describe('ProjectPage', () => {
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
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  async function open(url = '/p1'): Promise<void> {
    harness = await RouterTestingHarness.create(url);
  }

  async function settle(): Promise<void> {
    for (let round = 0; round < 4; round += 1) {
      await Promise.resolve();
      await harness.fixture.whenStable();
    }
  }

  function flushProjects(projects: readonly { id: string; name: string; description?: string }[]) {
    http.expectOne('/projects/api/projects').flush({
      entries: projects.map((project) => ({
        project: {
          id: project.id,
          name: project.name,
          slug: project.id,
          description: project.description ?? null,
          dns: null,
        },
      })),
    });
  }

  /** The epics are the page's own read; every test has to answer it. */
  function flushEpics(projectId = 'p1') {
    http.expectOne(`/projects/api/projects/${projectId}/epics`).flush({ entries: [] });
  }

  function page(): HTMLElement {
    return harness.fixture.nativeElement as HTMLElement;
  }

  it('names the project and reads its epics, and nothing else', async () => {
    await open();
    flushProjects([{ id: 'p1', name: 'qits', description: 'the platform' }]);
    flushEpics();
    await settle();

    expect(page().querySelector('h1')?.textContent).toContain('qits');
    expect(page().textContent).toContain('the platform');
    // No components read: those live behind project-setup now.
    http.verify();
  });

  /**
   * The panel is on the page and has cost nothing. `http.verify()` above already proves the second
   * half; this states the first, so that a panel accidentally made eager fails here by name rather
   * than as an unexpected request in an unrelated test.
   */
  it('offers the refinement agent closed, having asked nothing about it', async () => {
    await open();
    flushProjects([{ id: 'p1', name: 'qits' }]);
    flushEpics();
    await settle();

    const toggle = page().querySelector<HTMLButtonElement>('button.toggle');
    expect(toggle?.textContent).toContain('Refinement agent');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(page().textContent).toContain('Not started');
    http.verify();
  });

  it('says the project has no epics rather than leaving the section blank', async () => {
    await open();
    flushProjects([{ id: 'p1', name: 'qits' }]);
    flushEpics();
    await settle();

    expect(page().textContent).toContain('Epics');
    expect(page().textContent).toContain('This project has no epics yet.');
  });

  it('offers project setup as a link under the project’s own address', async () => {
    await open();
    flushProjects([{ id: 'p1', name: 'qits' }]);
    flushEpics();
    await settle();

    const setup = page().querySelector<HTMLAnchorElement>('a.setup');
    expect(setup?.textContent).toContain('Project setup');
    // Relative to the project route, so it never has to spell the id twice.
    expect(setup?.getAttribute('href')).toBe('/p1/project-setup');
  });

  it('navigates to the setup page when the action is followed', async () => {
    await open();
    flushProjects([{ id: 'p1', name: 'qits' }]);
    flushEpics();
    await settle();

    page().querySelector<HTMLAnchorElement>('a.setup')?.click();
    await settle();

    expect(TestBed.inject(Router).url).toBe('/p1/project-setup');
    // Arriving there is what triggers the components read.
    http.expectOne('/projects/api/projects/p1/repositories').flush({ entries: [], wrapper: null });
    await settle();
  });

  /** The name is a courtesy; a project list that never answered must not cost the page its action. */
  it('falls back to the id when the project list could not be read', async () => {
    await open();
    http.expectOne('/projects/api/projects').flush(null, { status: 503, statusText: 'Down' });
    flushEpics();
    await settle();

    expect(page().querySelector('h1')?.textContent).toContain('p1');
    expect(page().querySelector('a.setup')).not.toBeNull();
  });

  it('shows nothing but the name for a project id the list does not contain', async () => {
    await open('/nope');
    flushProjects([{ id: 'p1', name: 'qits' }]);
    flushEpics('nope');
    await settle();

    expect(page().querySelector('h1')?.textContent).toContain('nope');
    expect(page().querySelector('a.setup')?.getAttribute('href')).toBe('/nope/project-setup');
  });
});
