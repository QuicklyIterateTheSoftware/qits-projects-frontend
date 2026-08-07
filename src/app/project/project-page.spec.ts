import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../app.routes';

/**
 * The project's own address, which is now nearly empty on purpose.
 *
 * There is little to assert and that is the assertion: this page names the project, offers the way
 * in to setting it up, and — the part worth pinning — **asks the service for nothing of its own**.
 * The components read that used to happen here moved behind `project-setup`, and a page that
 * quietly kept making it would pay for a screen nobody is looking at.
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

  function page(): HTMLElement {
    return harness.fixture.nativeElement as HTMLElement;
  }

  it('names the project and asks for nothing else', async () => {
    await open();
    flushProjects([{ id: 'p1', name: 'qits', description: 'the platform' }]);
    await settle();

    expect(page().querySelector('h1')?.textContent).toContain('qits');
    expect(page().textContent).toContain('the platform');
    // No components read: those live behind project-setup now.
    http.verify();
  });

  it('offers project setup as a link under the project’s own address', async () => {
    await open();
    flushProjects([{ id: 'p1', name: 'qits' }]);
    await settle();

    const setup = page().querySelector<HTMLAnchorElement>('a.setup');
    expect(setup?.textContent).toContain('Project setup');
    // Relative to the project route, so it never has to spell the id twice.
    expect(setup?.getAttribute('href')).toBe('/p1/project-setup');
  });

  it('navigates to the setup page when the action is followed', async () => {
    await open();
    flushProjects([{ id: 'p1', name: 'qits' }]);
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
    await settle();

    expect(page().querySelector('h1')?.textContent).toContain('p1');
    expect(page().querySelector('a.setup')).not.toBeNull();
  });

  it('shows nothing but the name for a project id the list does not contain', async () => {
    await open('/nope');
    flushProjects([{ id: 'p1', name: 'qits' }]);
    await settle();

    expect(page().querySelector('h1')?.textContent).toContain('nope');
    expect(page().querySelector('a.setup')?.getAttribute('href')).toBe('/nope/project-setup');
  });
});
