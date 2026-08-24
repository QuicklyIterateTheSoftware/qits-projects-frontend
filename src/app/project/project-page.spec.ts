import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideQitsNavigationTree, type QitsNavigation } from '@qits/ui-components';
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
 * The reads worth pinning are the ones it does **not** make. The refinement agent is the rule with
 * the largest bill: a container is an image pull and a repository clone, so the panel is closed and
 * silent until it is asked for.
 *
 * Two reads it does make. The epics are the page's own subject and the overview owns that request.
 * The components read is what the ad-hoc workspace link costs: a project with no wrapper has
 * nothing to branch, which is why it shows no link at all.
 *
 * <p>Both are keyed on the project **id**, which the address does not carry — it names the slug —
 * so nothing is asked for until the shared project list has resolved the first segment. That is
 * why every test here flushes the list and settles before answering anything else, and it is what
 * the two failure cases at the bottom pin: an unresolved address costs no request at all.
 */
describe('ProjectPage', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;

  /**
   * The platform as the edge states it. The workspaces link is composed from this now, so a spec
   * that asserts it has to say what the platform serves — one entry, in the slot qits-workspaces
   * really occupies, or no entry at all.
   */
  function navigation(workspaces: boolean): QitsNavigation {
    return {
      environment: 'dev',
      origin: 'https://dev.example.test',
      slots: {
        'project.detail': workspaces
          ? [
              {
                app: 'qits-workspaces',
                label: 'Workspaces',
                host: 'workspaces',
                origin: 'https://workspaces.dev.example.test',
                path: '/workspaces',
                position: 1,
              },
            ]
          : [],
      },
    };
  }

  function configure(tree: QitsNavigation): void {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideLocationMocks(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: EVENT_SOURCE_FACTORY, useValue: SILENT },
        provideQitsNavigationTree(tree),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  }

  beforeEach(() => configure(navigation(true)));

  async function open(url = '/p1'): Promise<void> {
    harness = await RouterTestingHarness.create(url);
  }

  /**
   * Open the page and answer the project list, which is what turns the address's slug into the id
   * every other read is keyed on. Nothing else can be flushed before this has settled.
   */
  async function openResolved(
    projects: readonly { id: string; name: string; slug?: string; description?: string }[] = [
      { id: 'p1', name: 'qits' },
    ],
    url = '/p1',
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

  function flushProjects(
    projects: readonly { id: string; name: string; slug?: string; description?: string }[],
  ) {
    http.expectOne('/projects/api/projects').flush({
      entries: projects.map((project) => ({
        project: {
          id: project.id,
          name: project.name,
          slug: project.slug ?? project.id,
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

  /** The components read behind the ad-hoc workspace link. `wrapper` null is a project without one. */
  function flushComponents(wrapperRepositoryId: string | null = 'qits-qits', projectId = 'p1') {
    http.expectOne(`/projects/api/projects/${projectId}/repositories`).flush({
      entries: [],
      wrapper: wrapperRepositoryId
        ? { repositoryId: wrapperRepositoryId, branch: 'main', entries: [] }
        : null,
    });
  }

  function page(): HTMLElement {
    return harness.fixture.nativeElement as HTMLElement;
  }

  it('names the project and reads its epics and its wrapper, and nothing else', async () => {
    await openResolved([{ id: 'p1', name: 'qits', description: 'the platform' }]);
    flushEpics();
    flushComponents();
    await settle();

    expect(page().querySelector('h1')?.textContent).toContain('qits');
    expect(page().textContent).toContain('the platform');
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
    flushComponents();
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
    flushComponents();
    await settle();

    expect(page().textContent).toContain('Epics');
    expect(page().textContent).toContain('This project has no epics yet.');
  });

  it('offers project setup as a link under the project’s own address', async () => {
    await openResolved();
    flushEpics();
    flushComponents();
    await settle();

    const setup = page().querySelector<HTMLAnchorElement>('a.setup');
    expect(setup?.textContent).toContain('Project setup');
    // Relative to the project route, so it never has to spell the id twice.
    expect(setup?.getAttribute('href')).toBe('/p1/project-setup');
  });

  it('navigates to the setup page when the action is followed', async () => {
    await openResolved();
    flushEpics();
    flushComponents();
    await settle();

    page().querySelector<HTMLAnchorElement>('a.setup')?.click();
    await settle();

    expect(TestBed.inject(Router).url).toBe('/p1/project-setup');
    // The setup page reads the components for itself — the rows, which this page never asked for.
    http.expectOne('/projects/api/projects/p1/repositories').flush({ entries: [], wrapper: null });
    await settle();
  });

  /**
   * The ad-hoc workspace: a disposable checkout of the wrapper and every submodule under it.
   *
   * A plain `href` and not a `routerLink` — qits-workspaces is another Angular application on a
   * host of its own, so this is a page load and the router knows nothing about the address.
   */
  it('links to the workspaces app with the project’s wrapper preselected', async () => {
    await openResolved();
    flushEpics();
    flushComponents('qits-qits');
    await settle();

    const adhoc = page().querySelector<HTMLAnchorElement>('a.adhoc');
    expect(adhoc?.textContent).toContain('Ad-hoc workspace');
    // The workspaces host, scoped to this project — not a query parameter naming a repository id.
    expect(adhoc?.getAttribute('href')).toBe('https://workspaces.dev.example.test/p1/');
  });

  /** No wrapper, nothing to branch: a link that named no repository would offer a create nobody
   * could complete. */
  it('offers no ad-hoc workspace for a project with no wrapper', async () => {
    await openResolved();
    flushEpics();
    flushComponents(null);
    await settle();

    expect(page().querySelector('a.adhoc')).toBeNull();
    // The other action is untouched by it.
    expect(page().querySelector('a.setup')).not.toBeNull();
  });

  /**
   * A platform naming no workspaces application gives no address, and the page draws no link.
   *
   * There is nothing left to guess with: every service is on a host of its own, so the old
   * `/workspaces/` segment under the environment origin is not an address any more.
   */
  it('offers no ad-hoc workspace when the platform names no workspaces application', async () => {
    TestBed.resetTestingModule();
    configure(navigation(false));
    await openResolved();
    flushEpics();
    flushComponents('qits-qits');
    await settle();

    expect(page().querySelector('a.adhoc')).toBeNull();
    expect(page().querySelector('a.setup')).not.toBeNull();
  });

  /**
   * A list that never answered leaves the page with an address and no id, so it asks for nothing —
   * and still draws its name from the segment and its one action. The reads are keyed on the id
   * and there is no id, which is why `http.verify()` is the assertion that matters here.
   */
  it('falls back to the address when the project list could not be read', async () => {
    await open();
    http.expectOne('/projects/api/projects').flush(null, { status: 503, statusText: 'Down' });
    await settle();

    expect(page().querySelector('h1')?.textContent).toContain('p1');
    expect(page().querySelector('a.setup')).not.toBeNull();
    http.verify();
  });

  it('asks for nothing at all for a slug the list does not contain', async () => {
    await openResolved([{ id: 'p1', name: 'qits' }], '/nope');

    expect(page().querySelector('h1')?.textContent).toContain('nope');
    expect(page().querySelector('a.setup')?.getAttribute('href')).toBe('/nope/project-setup');
    http.verify();
  });

  /**
   * An address spelling the project **id** is corrected in place rather than served: every URL this
   * application wrote before the slug convention carries one, and a 404 would break links that are
   * only old.
   */
  it('redirects an id in the first segment to the slug, keeping the rest of the path', async () => {
    await openResolved([{ id: 'p1', name: 'qits', slug: 'qits' }], '/p1');
    flushEpics();
    flushComponents();
    await settle();

    expect(TestBed.inject(Router).url).toBe('/qits');
    expect(page().querySelector('a.setup')?.getAttribute('href')).toBe('/qits/project-setup');
  });
});
