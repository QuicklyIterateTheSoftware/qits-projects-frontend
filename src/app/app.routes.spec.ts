import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import type { Type } from '@angular/core';
import { Location } from '@angular/common';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideQitsScope } from '@qits/ui-components';
import { AgentMcpCatalogPage } from './agent-config/agent-mcp-catalog-page';
import { AgentSurfacePage } from './agent-config/agent-surface-page';
import { AgentSurfaceSkillsPage } from './agent-config/agent-surface-skills-page';
import { AgentSurfacesPage } from './agent-config/agent-surfaces-page';
import { RunnersPage } from './runners/runners-page';
import { OWN_PROJECT_SEGMENTS, routes } from './app.routes';
import { EVENT_SOURCE_FACTORY, type EventSourceFactory } from './api/event-source';
import { CreateRepositoryPage } from './create/create-repository-page';
import { LandingPage } from './landing/landing-page';
import { NotFound } from './not-found/not-found';
import { EntityDetailPage } from './project/entity-detail-page';
import { EntitySlugResolver } from './project/entity-slug-resolver';
import { ProjectPage } from './project/project-page';
import { ProjectReleaseRequestsPage } from './project/project-release-requests-page';
import { ProjectSetupPage } from './project/project-setup-page';
import { ReleaseRequestByReleaseResolver } from './project/release-request-by-release-resolver';
import { ReleaseRequestDetailPage } from './project/release-request-detail-page';
import { RepositoryPage } from './project/repository-page';
import { RepositoryReleaseRequestsPage } from './project/repository-release-requests-page';
import { WorkPage } from './project/work-page';
import { RefiningPage } from './refining/refining-page';

/** jsdom has no `EventSource`, and the epics overview opens one on the epics page. */
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
   * **The one desk** (qits-397): every archetype on one page, the archetype a query-parameter filter
   * rather than a second route.
   */
  it('serves the one desk one segment below the project, which is the hub', async () => {
    expect(await at('/qits/work')).toBe(WorkPage);
    expect(await at('/qits/work?archetype=ticket')).toBe(WorkPage);
    expect(await at('/qits')).toBe(ProjectPage);
  });

  /**
   * One node — of any archetype — at the desk's address plus its qualified number, and its room one
   * segment further down.
   */
  it('serves one node by its qualified number below the desk, and its room below that', async () => {
    expect(await at('/qits/work/qits-1337')).toBe(EntityDetailPage);
    expect(await at('/qits/work/1337')).toBe(EntityDetailPage);
    expect(await at('/qits/work/qits-1337/refinement')).toBe(RefiningPage);
  });

  /**
   * **The literal `work` segment is what makes a number unambiguous.** A number directly below the
   * project would be a two-segment address — which is where the project's own words live — and a
   * number with anything after it would be three segments, which is the repository grammar. So a
   * bare number reads as neither a node nor a project word, and the node lives only under `work`,
   * where neither the repository guard nor a project word can claim it.
   */
  it('never reads a number directly below the project, which only `work` may carry', async () => {
    expect(await at('/qits/qits-1337')).toBe(NotFound);
    expect(await at('/qits/project-setup')).toBe(ProjectSetupPage);
    expect(await at('/qits/qits-ci/qits-1337')).toBe(RepositoryPage);
    expect(await at('/qits/work/qits-1337')).toBe(EntityDetailPage);
    // `work` is an own word, so the guard refuses it as a repository group four segments deep too.
    expect(await at('/qits/work/qits-1337/release-requests')).toBe(NotFound);
    expect(await at('/qits/work/qits-1337/refinement/extra')).toBe(NotFound);
  });

  /** The old desks redirect to the one desk, with the archetype filter set. */
  it('redirects the old epics and tickets desks to the one desk, filtered', async () => {
    expect(await at('/qits/epics')).toBe(WorkPage);
    expect(TestBed.inject(Location).path()).toBe('/qits/work?archetype=epic');

    expect(await at('/qits/tickets')).toBe(WorkPage);
    expect(TestBed.inject(Location).path()).toBe('/qits/work?archetype=ticket');
  });

  /**
   * The old slug addresses — a ticket's page and an epic's refining room — are in links people have
   * sent each other, so they resolve: only a read can turn a slug into a number, which is the
   * resolver's job (its own spec is the entity-slug-resolver's).
   */
  it('resolves the old slug addresses rather than 404ing them', async () => {
    expect(await at('/qits/tickets/cancelled-badge')).toBe(EntitySlugResolver);
    expect(await at('/qits/epics/epic-refining-workspace/refining')).toBe(EntitySlugResolver);
  });

  /**
   * The project's release requests are a sub-element of the same shape, and the address the
   * `project.detail` navigation entry composes: the project's scope path plus the entry's subpath.
   */
  it('serves the project-wide release requests beside the board', async () => {
    expect(await at('/qits/release-requests')).toBe(ProjectReleaseRequestsPage);
    // Its own word is still not a group — what hangs below it is a request id and never a
    // repository, which is why the segment below resolves to the detail page rather than to one.
    expect(await at('/qits/release-requests/qits-ci/more')).toBe(NotFound);
  });

  /**
   * **The project's own release request**, at the project's address and with no repository segment
   * in it. The wrapper is in no component and in no archetype category — it *is* the tree — so the
   * five-segment form could only reach it by inventing a group and calling it a service. The page is
   * the same page; what the address says about it is what differs.
   */
  it('serves one project-scoped release request, which is the estate’s own', async () => {
    expect(await at('/qits/release-requests/r1')).toBe(ReleaseRequestDetailPage);
  });

  /**
   * The two addresses below `release-requests` are told apart by the order they are declared in and
   * by their length. `by-release` is the literal and is declared first, so it can never be read as a
   * request whose id is the word `by-release`; the list is shorter than both and is declared above
   * them.
   */
  it('keeps the by-release resolver and the list out of the request address', async () => {
    expect(await at('/qits/release-requests/by-release/repo-ci/2026.905.91746')).toBe(
      ReleaseRequestByReleaseResolver,
    );
    expect(await at('/qits/release-requests')).toBe(ProjectReleaseRequestsPage);
    expect(await at('/qits/release-requests/r1')).toBe(ReleaseRequestDetailPage);
  });

  /**
   * The by-release address is a *resolver* and not a page: a linker holds a repository and a version
   * and never the request's id. It is five segments below a project, so what it proves here is that
   * the literal wins over the guarded `:group` routes — which is route order, and the one thing in
   * this table that fails silently.
   */
  it('serves the by-release resolver below the project, not a repository page', async () => {
    expect(await at('/qits/release-requests/by-release/repo-ci/2026.905.91746')).toBe(
      ReleaseRequestByReleaseResolver,
    );
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
   * `apps` reached this page through the guard's *second* branch — an unclaimed word — for the
   * release in which this application knew the category and the installed chrome did not, and it
   * reaches it through `QITS_CATEGORIES` now that the chrome has learned it. The address reads the
   * same either way, which is the whole point of asking the question the open-set way round, and
   * this is what fails if somebody re-closes the set.
   */
  it('serves the repository page for an app, whichever branch of the guard claims it', async () => {
    expect(await at('/qits/apps/qits-docs-app')).toBe(RepositoryPage);
    expect(await at('/qits/apps/qits-docs-app/release-requests')).toBe(
      RepositoryReleaseRequestsPage,
    );
    expect(await at('/qits/apps/qits-docs-app/release-requests/r1')).toBe(ReleaseRequestDetailPage);
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
    // `tickets` and `work` are those words by derivation, so the guard refuses them too — and the
    // literal routes above still win, which is the assertion further up.
    expect(await at('/qits/tickets/one/two')).toBe(NotFound);
    expect(await at('/qits/work/one/two')).toBe(NotFound);
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

  /**
   * One request is a place of its own, at the list's address plus its id — which is what makes the
   * link from a row a relative `['./', id]` rather than a second spelling of the address.
   */
  it('serves one release request below its repository list', async () => {
    expect(await at('/qits/services/qits-ci/release-requests/r1')).toBe(ReleaseRequestDetailPage);
    expect(await at('/qits/qits-ci/qits-ci-service/release-requests/r1')).toBe(
      ReleaseRequestDetailPage,
    );
    // The guard still applies to the middle segment, five segments deep as at three.
    expect(await at('/qits/epics/planning/release-requests/r1')).toBe(NotFound);
  });

  /**
   * The one word this application claims above `:project`, because what it configures is
   * platform-wide rather than a project's. Order is what makes it work — the literal is declared
   * before `:project`, so it wins — and asserting the address rather than the table is what would
   * catch somebody moving it below.
   */
  it('serves the agent configuration above the projects, being platform-wide', async () => {
    expect(await at('/agent-configuration')).toBe(AgentSurfacesPage);
    expect(await at('/agent-configuration/mcp-catalog')).toBe(AgentMcpCatalogPage);
    expect(await at('/agent-configuration/surfaces/epic.chat')).toBe(AgentSurfacePage);
    // Reserved, reachable and empty: fixing where per-surface skills will live is the whole scope.
    expect(await at('/agent-configuration/surfaces/epic.chat/skills')).toBe(AgentSurfaceSkillsPage);
  });

  it('serves the front-desk runners above the projects, being estate-wide', async () => {
    expect(await at('/runners')).toBe(RunnersPage);
  });

  it('answers anything deeper with the 404 it is', async () => {
    expect(await at('/qits/services/qits-ci/runs')).toBe(NotFound);
    expect(await at('/qits/project-setup/extra')).toBe(NotFound);
    expect(await at('/qits/services/qits-ci/release-requests/r1/extra')).toBe(NotFound);
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
    expect([...OWN_PROJECT_SEGMENTS].sort()).toEqual([
      'epics',
      'project-setup',
      'release-requests',
      'repositories',
      'tickets',
      'work',
    ]);
  });

  it('takes no route parameter for a word of its own', () => {
    for (const segment of OWN_PROJECT_SEGMENTS) {
      expect(segment.startsWith(':')).toBe(false);
    }
  });
});
