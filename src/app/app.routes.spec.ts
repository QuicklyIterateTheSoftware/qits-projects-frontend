import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import type { Type } from '@angular/core';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideQitsScope } from '@qits/ui-components';
import { routes } from './app.routes';
import { EVENT_SOURCE_FACTORY, type EventSourceFactory } from './api/event-source';
import { CreateRepositoryPage } from './create/create-repository-page';
import { LandingPage } from './landing/landing-page';
import { NotFound } from './not-found/not-found';
import { ProjectPage } from './project/project-page';
import { ProjectSetupPage } from './project/project-setup-page';
import { RepositoryPage } from './project/repository-page';

/** jsdom has no `EventSource`, and the epics overview opens one on the project page. */
const SILENT: EventSourceFactory = () => ({
  onopen: null,
  onmessage: null,
  onerror: null,
  close: () => undefined,
});

/**
 * The address grammar, asserted as addresses rather than as a route table.
 *
 * <p>Two things here are easy to break and impossible to see: the **order** of the routes, and the
 * **category guard**. Without the order, `/qits/repositories/new` is a repository called `new` in a
 * category called `repositories`; without the guard, every three-segment address in the application
 * is a repository page drawing a repository nobody has.
 *
 * <p>Nothing is flushed: what is under test is which component the router builds, and the reads a
 * page makes are its own spec's business. The project list is answered where a page needs it to get
 * as far as rendering.
 */
describe('routes', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideLocationMocks(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: EVENT_SOURCE_FACTORY, useValue: SILENT },
        // The repository page reads the scope rather than the route parameters, which is the
        // platform's rule — so routing to one needs the scope this application declares.
        provideQitsScope('repository'),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    harness = await RouterTestingHarness.create();
  });

  /** Every request the routed page opened, answered with nothing, so `verify` has nothing to say. */
  function drain(): void {
    for (const request of http.match(() => true)) {
      request.flush({ entries: [], refinements: [] });
    }
  }

  /**
   * The component the address resolves to — the **deepest** one, because every route here is a
   * child of the chrome and the harness hands back the outermost.
   */
  async function at(url: string): Promise<Type<unknown> | null> {
    await harness.navigateByUrl(url);
    drain();
    let route = TestBed.inject(Router).routerState.snapshot.root;
    while (route.firstChild) {
      route = route.firstChild;
    }
    return (route.component as Type<unknown> | null) ?? null;
  }

  it('serves the landing page at the root, which is this host now', async () => {
    expect(await at('/')).toBe(LandingPage);
  });

  it('reads the first segment as a project, and its own literals below it', async () => {
    expect(await at('/qits')).toBe(ProjectPage);
    expect(await at('/qits/project-setup')).toBe(ProjectSetupPage);
    expect(await at('/qits/repositories/new')).toBe(CreateRepositoryPage);
  });

  /**
   * The repository form, and the reason its literal siblings are declared above it:
   * `repositories/new` is three segments too, and would otherwise read as a repository called
   * `new`. The guard refuses it as well, which is belt and braces on purpose — the order is the
   * rule, and the guard is what makes a mistake in the order fail loudly instead of quietly.
   */
  it('serves the repository page for a known category, in the platform-wide shape', async () => {
    expect(await at('/qits/services/qits-ci')).toBe(RepositoryPage);
    expect(await at('/qits/libs/qits-db-core')).toBe(RepositoryPage);
    expect(await at('/qits/images/qits-oci')).toBe(RepositoryPage);
  });

  it('refuses a second segment that names no category', async () => {
    expect(await at('/qits/epics/planning')).toBe(NotFound);
    expect(await at('/qits/Services/qits-ci')).toBe(NotFound);
  });

  it('answers anything deeper with the 404 it is', async () => {
    expect(await at('/qits/services/qits-ci/runs')).toBe(NotFound);
    expect(await at('/qits/project-setup/extra')).toBe(NotFound);
  });
});
