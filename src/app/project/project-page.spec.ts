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
 * A stream that never says anything. jsdom has no `EventSource` at all, and the epics page opens
 * one — a spec that navigates there only needs the channel to exist.
 */
const SILENT: EventSourceFactory = () => ({
  onopen: null,
  onmessage: null,
  onerror: null,
  // Nothing to close: nothing was ever opened.
  close: () => undefined,
});

/**
 * The project's own address: a hub node, and nothing else.
 *
 * <p>The assertion that carries the most is `http.verify()`: this page reads **nothing**. The name
 * and the description come from the shared project list the address's slug was resolved against, and
 * the cards are composed from the navigation the chrome already asked the edge for — so a hub that
 * grew a request of its own would fail here rather than by feeling slow in front of somebody.
 *
 * <p>The rest is the link set. Two cards are this application's own routes and are asserted as
 * relative addresses; the others are other applications on hosts of their own, so they are whole
 * URLs, and an entry this application itself declares is dropped rather than drawn beside the
 * router hop that already leads there.
 */
describe('ProjectPage', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;

  /**
   * The platform as the edge states it. The project's sub-elements are composed from this, so a
   * spec that asserts them has to say what the platform serves — including this application's own
   * placement, which is how the Epics row reaches the sidebar and which this page must not draw
   * twice.
   */
  function navigation(entries: 'full' | 'none' = 'full'): QitsNavigation {
    return {
      environment: 'dev',
      origin: 'https://dev.example.test',
      slots: {
        'project.detail':
          entries === 'none'
            ? []
            : [
                {
                  app: 'qits-projects',
                  label: 'Epics',
                  host: 'projects',
                  origin: 'https://projects.dev.example.test',
                  path: '/projects',
                  position: 1,
                  subpath: 'epics',
                },
                {
                  app: 'qits-workspaces',
                  label: 'Workspaces',
                  host: 'workspaces',
                  origin: 'https://workspaces.dev.example.test',
                  path: '/workspaces',
                  position: 1,
                },
                {
                  app: 'qits-workspaces',
                  label: 'Editor',
                  host: 'workspaces',
                  origin: 'https://workspaces.dev.example.test',
                  path: '/workspaces',
                  position: 2,
                  subpath: 'editor',
                },
              ],
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

  beforeEach(() => configure(navigation()));

  async function open(url = '/p1'): Promise<void> {
    harness = await RouterTestingHarness.create(url);
  }

  /**
   * Open the page and answer the project list, which is what turns the address's slug into the name
   * and the description this page draws — and the only request it takes part in.
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

  function page(): HTMLElement {
    return harness.fixture.nativeElement as HTMLElement;
  }

  /** Every card on the page, in the order it is drawn: its label and where it leads. */
  function cards(): readonly { label: string; href: string | null }[] {
    return Array.from(page().querySelectorAll<HTMLAnchorElement>('a.app')).map((anchor) => ({
      label: anchor.querySelector('.app-label')?.textContent?.trim() ?? '',
      href: anchor.getAttribute('href'),
    }));
  }

  it('names the project, says what it is, and asks for nothing of its own', async () => {
    await openResolved([{ id: 'p1', name: 'qits', description: 'the platform' }]);

    expect(page().querySelector('h1')?.textContent).toContain('qits');
    expect(page().querySelector('.description')?.textContent).toContain('the platform');
    http.verify();
  });

  /** No description is not an empty paragraph: the hub then holds the links and nothing else. */
  it('draws no description for a project that has none', async () => {
    await openResolved([{ id: 'p1', name: 'qits' }]);

    expect(page().querySelector('.description')).toBeNull();
    expect(cards().length).toBeGreaterThan(0);
  });

  /**
   * The sub-elements, in the order a reader needs them: this application's own two first — the plan,
   * then the configuration — and the platform's after them, in the order the edge sorted them.
   *
   * The `qits-projects` entry in the same slot is this application's own Epics row in the sidebar.
   * Drawing it here as well would put one destination on the page twice, once as a router hop and
   * once as a page load, so it is dropped in favour of the hop.
   */
  it('links to every sub-element once, its own with the router and the rest by host', async () => {
    await openResolved();

    expect(cards()).toEqual([
      { label: 'Epics', href: '/p1/epics' },
      { label: 'Release requests', href: '/p1/release-requests' },
      { label: 'Project setup', href: '/p1/project-setup' },
      { label: 'Workspaces', href: 'https://workspaces.dev.example.test/p1/' },
      { label: 'Editor', href: 'https://workspaces.dev.example.test/p1/editor' },
    ]);
  });

  /** A platform that names no project-scoped application still has the three this SPA serves itself. */
  it('keeps its own links when the platform names no other application', async () => {
    TestBed.resetTestingModule();
    configure(navigation('none'));
    await openResolved();

    expect(cards()).toEqual([
      { label: 'Epics', href: '/p1/epics' },
      { label: 'Release requests', href: '/p1/release-requests' },
      { label: 'Project setup', href: '/p1/project-setup' },
    ]);
  });

  it('goes to the epics board when its card is followed', async () => {
    await openResolved();

    page().querySelector<HTMLAnchorElement>('a.app')?.click();
    await settle();

    expect(TestBed.inject(Router).url).toBe('/p1/epics');
    // The board reads the epics for itself, which is the read this page does not do.
    http.expectOne('/projects/api/projects/p1/epics').flush({ entries: [] });
    await settle();
  });

  /**
   * A list that never answered leaves the page with an address and no project, so it names the
   * address and still offers every way in — the links are spelled from the segment.
   */
  it('falls back to the address when the project list could not be read', async () => {
    await open();
    http.expectOne('/projects/api/projects').flush(null, { status: 503, statusText: 'Down' });
    await settle();

    expect(page().querySelector('h1')?.textContent).toContain('p1');
    expect(cards()[0]).toEqual({ label: 'Epics', href: '/p1/epics' });
    http.verify();
  });

  it('asks for nothing at all for a slug the list does not contain', async () => {
    await openResolved([{ id: 'p1', name: 'qits' }], '/nope');

    expect(page().querySelector('h1')?.textContent).toContain('nope');
    expect(cards()[2]).toEqual({ label: 'Project setup', href: '/nope/project-setup' });
    http.verify();
  });

  /**
   * An address spelling the project **id** is corrected in place rather than served: every URL this
   * application wrote before the slug convention carries one, and a 404 would break links that are
   * only old.
   */
  it('redirects an id in the first segment to the slug, keeping the rest of the path', async () => {
    await openResolved([{ id: 'p1', name: 'qits', slug: 'qits' }], '/p1');

    expect(TestBed.inject(Router).url).toBe('/qits');
    expect(cards()[0]).toEqual({ label: 'Epics', href: '/qits/epics' });
  });
});
