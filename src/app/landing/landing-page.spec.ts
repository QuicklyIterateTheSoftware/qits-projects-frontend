import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../app.routes';
import { EVENT_SOURCE_FACTORY, type EventSourceFactory } from '../api/event-source';

/**
 * A stream that never says anything. The redirect lands on the project page, whose epics overview
 * opens a live channel — and jsdom has no `EventSource` at all.
 */
const SILENT: EventSourceFactory = () => ({
  onopen: null,
  onmessage: null,
  onerror: null,
  // Nothing to close: nothing was ever opened.
  close: () => undefined,
});

/**
 * `/projects/` with nothing chosen: the three shapes the platform can be in, and the redirect.
 *
 * The redirect is asserted **with its history behaviour**, because getting that wrong is invisible
 * until somebody presses back: without `replaceUrl` the landing page stays in the history and
 * immediately redirects forward again, which is a page the reader cannot leave.
 */
describe('LandingPage', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;
  let router: Router;

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
    router = TestBed.inject(Router);
  });

  async function open(): Promise<void> {
    harness = await RouterTestingHarness.create('/');
  }

  async function settle(): Promise<void> {
    for (let round = 0; round < 6; round += 1) {
      await Promise.resolve();
      await harness.fixture.whenStable();
    }
  }

  function flushProjects(ids: readonly string[]): void {
    http.expectOne('/projects/api/projects').flush({
      entries: ids.map((id) => ({
        project: { id, name: `${id} project`, slug: id, description: null, dns: null },
      })),
    });
  }

  function text(): string {
    return (harness.fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  it('says the platform holds no projects, rather than drawing an empty list', async () => {
    await open();
    flushProjects([]);
    await settle();

    expect(text()).toContain('No projects yet.');
    expect(router.url).toBe('/');
  });

  /** One project is the shape of this platform today, so the picker would be a question with one
      possible answer. */
  it('goes straight to the only project there is, replacing the history entry', async () => {
    await open();
    flushProjects(['p1']);
    await settle();

    expect(router.url).toBe('/p1');
    // The project page took over. It names itself from the list the store already holds, so the
    // redirect costs no second project read — only the epics it is there to show, and the wrapper
    // behind its ad-hoc workspace link.
    await settle();
    expect(text()).toContain('p1 project');
    http.expectOne('/projects/api/projects/p1/epics').flush({ entries: [] });
    http.expectOne('/projects/api/projects/p1/repositories').flush({ entries: [], wrapper: null });
    await settle();
    http.verify();
  });

  it('asks for a choice when there is more than one, and lists them', async () => {
    await open();
    flushProjects(['p1', 'p2']);
    await settle();

    expect(text()).toContain('Select a project');
    expect(text()).toContain('p1 project');
    expect(text()).toContain('p2 project');
    expect(router.url).toBe('/');
  });

  it('offers a retry when the list could not be read', async () => {
    await open();
    http.expectOne('/projects/api/projects').flush(null, { status: 503, statusText: 'Down' });
    await settle();

    expect(text()).toContain('Could not load the projects — 503');

    const retry = Array.from(
      (harness.fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find((button) => (button.textContent ?? '').includes('Retry'));
    retry?.click();
    await settle();

    flushProjects([]);
    await settle();
    expect(text()).toContain('No projects yet.');
  });
});
