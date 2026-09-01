import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import type { Type } from '@angular/core';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideQitsScope } from '@qits/ui-components';
import { OWN_PROJECT_SEGMENTS, routes } from './app.routes';
import { EVENT_SOURCE_FACTORY, type EventSourceFactory } from './api/event-source';
import { CreateRepositoryPage } from './create/create-repository-page';
import { LandingPage } from './landing/landing-page';
import { NotFound } from './not-found/not-found';
import { ProjectPage } from './project/project-page';
import { ProjectSetupPage } from './project/project-setup-page';
import { RepositoryPage } from './project/repository-page';
import { RepositoryReleaseRequestsPage } from './project/repository-release-requests-page';

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
 * **group guard**. Without the order, `/qits/repositories/new` is a repository called `new` in a
 * group called `repositories`; without the guard, this application's own words below a project are
 * repository pages drawing repositories nobody has.
 *
 * <p>The guard is an inversion now, because the middle segment is a repository's **component** and
 * component names are an open set: a segment is a group unless it is one of this app's own. So an
 * address naming no component at all resolves to the repository page, which draws the ordinary
 * not-found itself — the same page, reached the other way round.
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

  /**
   * The component form of the same address, which no compiled-in set could ever prove: component
   * names are the platform's, so the guard has to let an unclaimed word through.
   */
  it('serves the repository page for a component, which is an open name', async () => {
    expect(await at('/qits/qits-ci/qits-ci-service')).toBe(RepositoryPage);
    expect(await at('/qits/qits-ui-components/qits-ui-components-jslib')).toBe(RepositoryPage);
  });

  /**
   * This application's own words below a project are never a group — the one thing the guard still
   * refuses outright, and the reason it reads them off the route table rather than a second list.
   */
  it('refuses a second segment this application has claimed for itself', async () => {
    expect(await at('/qits/epics/planning')).toBe(NotFound);
    expect(await at('/qits/repositories/qits-ci')).toBe(NotFound);
    expect(await at('/qits/project-setup/qits-ci')).toBe(NotFound);
  });

  /**
   * A view of a repository is its three segments plus a fourth, which is what the application's
   * own `<category>.details.*` navigation entries compose — so the sidebar's row and the page the
   * router builds are one URL by construction. The api-docs sibling is asserted in its own spec,
   * which provides the navigation it frames a document from; this is the address grammar.
   */
  it('serves a repository view below the repository itself', async () => {
    expect(await at('/qits/services/qits-ci/release-requests')).toBe(RepositoryReleaseRequestsPage);
    expect(await at('/qits/qits-ci/qits-ci-service/release-requests')).toBe(
      RepositoryReleaseRequestsPage,
    );
    // The guard still applies to the middle segment, so this app's own words are not repositories
    // with a view hanging off them.
    expect(await at('/qits/epics/planning/release-requests')).toBe(NotFound);
  });

  it('answers anything deeper with the 404 it is', async () => {
    expect(await at('/qits/services/qits-ci/runs')).toBe(NotFound);
    expect(await at('/qits/project-setup/extra')).toBe(NotFound);
  });
});

/**
 * The own-word list the guard inverts, asserted against the table it is derived from.
 *
 * A hand-written copy is exactly the thing that stops matching the routes it is about, and the
 * symptom would be an address quietly resolving to the wrong page — so the derivation is what is
 * under test here, not the three words.
 */
describe('OWN_PROJECT_SEGMENTS', () => {
  it('names every literal this application routes below a project, and nothing else', () => {
    expect([...OWN_PROJECT_SEGMENTS].sort()).toEqual(['epics', 'project-setup', 'repositories']);
  });

  it('takes no route parameter for a word of its own', () => {
    for (const segment of OWN_PROJECT_SEGMENTS) {
      expect(segment.startsWith(':')).toBe(false);
    }
  });
});
