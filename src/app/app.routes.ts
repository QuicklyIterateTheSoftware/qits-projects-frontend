import type { CanMatchFn, Routes } from '@angular/router';
import { QITS_CATEGORIES, QitsMainLayout, type QitsCategory } from '@qits/ui-components';
import { CreateRepositoryPage } from './create/create-repository-page';
import { LandingPage } from './landing/landing-page';
import { NotFound } from './not-found/not-found';
import { EpicsPage } from './project/epics-page';
import { ProjectPage } from './project/project-page';
import { ProjectReleaseRequestsPage } from './project/project-release-requests-page';
import { ProjectSetupPage } from './project/project-setup-page';
import { ReleaseRequestDetailPage } from './project/release-request-detail-page';
import { RepositoryApiDocsPage } from './project/repository-api-docs-page';
import { RepositoryPage } from './project/repository-page';
import { RepositoryReleaseRequestsPage } from './project/repository-release-requests-page';
import { RefiningPage } from './refining/refining-page';

/**
 * Whether the second segment of `/<project>/<group>/<repository>` names a group.
 *
 * <p>Without it every three-segment address in the application would be a repository. The test used
 * to be one set membership, because the group was always one of the six archetype categories. A
 * repository is addressed by its **component** now, and component names are an *open* set only the
 * platform knows — so a closed test cannot prove one, and the question has to be asked the other
 * way round: **a segment is a group unless this application has claimed the word for itself.** The
 * six categories still answer on their own, which keeps every archetype address reading before any
 * list has arrived.
 *
 * <p>The own-word list is {@link OWN_PROJECT_SEGMENTS}, read off the route table itself, so a route
 * added below `:project` cannot be swallowed by forgetting to name it here. Route *order* already
 * wins for those addresses; this is what makes a mistake in the order fail loudly instead of
 * quietly, which is the job the closed set used to do.
 *
 * <p><b>The deliberate consequence</b>: `/qits/nonsense/qits-ci` matches now, where it used to be a
 * 404. Nothing is lost — the repository page draws the ordinary not-found for a repository the
 * project does not hold, which is the same page — and the chrome agrees, because `parseScope`
 * leaves an unproven component as the project alone rather than refusing the address.
 *
 * <p>`segments` is what is left *below* this route, so segment 0 is the project and segment 1 the
 * group.
 */
export const repositoryGroupIsKnown: CanMatchFn = (_route, segments) => {
  const group = segments[1]?.path ?? '';
  if (QITS_CATEGORIES.includes(group as QitsCategory)) {
    return true;
  }
  return group.length > 0 && !OWN_PROJECT_SEGMENTS.has(group);
};

/**
 * Twelve routes, all of them inside the platform chrome.
 *
 * `QitsMainLayout` is the root *route* component rather than something the shell templates, so the
 * bar, the navigation and the project picker hanging under it mount once and survive every
 * navigation beneath them; only the outlet's content changes.
 *
 * <p><b>The project SLUG is the first segment, with no collection segment above it.</b>
 * `/qits`, not `/projects/projects/<id>`: this service has a host of its own now
 * (`projects.<env>.<domain>`), so the SPA is served at `/` and there is no application segment to
 * spend. The slug and not the id, because that is the platform's URL convention on every host —
 * see `nav/project-param.ts` for how an old address spelling an id is corrected in place.
 *
 * <p>`?type=` on the create page is a **prefill, not an address**: it seeds the archetype picker,
 * the picker is free to disagree with it, and a create page reached from a group's "New service"
 * link and one reached from the sub-menu are the same page. That is view state, so it is a query
 * parameter and not a segment.
 *
 * <p><b>`project-setup` is a segment because setting a project up is rare.</b> The project's own
 * address used to carry the component groups and the reconcile, which made the page a reader
 * arrives at most often the page they need least. Splitting them puts configuration one deliberate
 * click away and leaves `:project` free for what a project is mostly for. It is a path segment
 * rather than a query parameter because it is a different *place*, not a view of the same one.
 *
 * <p><b>`:project` is a hub and `:project/epics` is the plan.</b> The board used to be what the
 * bare project address rendered, which made it a page with no name: the chrome's Project row leads
 * here, and nothing in the sidebar said that the epics were what "here" meant. Giving the board a
 * segment of its own makes it a sub-element beside `project-setup` and the workspaces application's
 * `workspaces`/`editor` — one row per place, and the project node itself is then what a repository's
 * node already is, a name and the ways into it. The refinement agent came down with the board,
 * because the agent is what changes the epics and the two are one surface.
 *
 * <p><b>`:project/release-requests` is the same sub-element shape, one scope up from the
 * repository's own.</b> It answers what is waiting to be released anywhere in the project, which is
 * a question the sidebar could not put anywhere: the per-repository rows hang under a repository, so
 * finding one open request meant opening every repository in turn. Its row reaches the chrome the
 * way the repository ones do — `project.detail.Release Requests:3=release-requests` in this
 * repository's service's `deployments.yml`, below qits-workspaces' Workspaces 1 and Editor 2 — and
 * it is a registry entry rather than something this SPA declares because the shared chrome draws the
 * Project node's children itself, so there is no other way to put a row there.
 *
 * <p><b>`:project/:group/:repository` is the repository detail</b>, the address every other SPA
 * on the platform also serves — so the sidebar's per-repository entries and this page's cards are
 * the same URL with a different host in front. The middle segment is the repository's **component**
 * where the platform gives it one and its archetype category where it does not, which is why the
 * parameter is `:group` and not `:category`. It is guarded on that segment, which is what keeps it
 * from swallowing every three-segment address; the literal routes above it win regardless, because
 * Angular matches in order.
 *
 * <p><b>`:project/:group/:repository/api-docs` is a view of that repository</b> — the address
 * this application's own `services.details.Api Docs:6=api-docs` navigation entry composes. Same
 * guard, for the same reason: the fourth segment does not make `/qits/epics/planning/api-docs` a
 * repository.
 *
 * <p><b>`:project/:group/:repository/release-requests` is the second such view</b>, and the one
 * this application currently *has* a sidebar row for: `<category>.details.Release Requests:3=release-requests`
 * in this repository's `deployments.yml`, declared on all six archetype slots so every kind of
 * repository carries the row. The address is the same three segments with a fourth, so the entry
 * the chrome composes and the page the router builds are one URL by construction.
 *
 * <p><b>One request is the fifth segment</b>, `:project/:group/:repository/release-requests/:requestId`,
 * and it is a place rather than an expanded row: it costs four reads — the request, the commits its
 * fold brought in, what it published, and where its deployment got to — three of which reach a
 * different service and none of which could ride on a list that polls. The address is the list's own
 * plus the request's id, so the link from a row is a relative `['./', id]` and cannot drift from it.
 *
 * <p><b>The refining route names an epic and never a workspace.</b>
 * `:project/epics/:epicSlug/refining` is where an epic is worked out, and the workspace behind it is
 * *looked up* — the ACTIVE workspace on `refining/<epicSlug>` in the project's wrapper repository.
 * Nothing stores that association, so an address carrying a workspace row id would be a link that rots
 * the moment the workspace is discarded and a new one started: it would point at a resolved workspace
 * with no container, for an epic that is being refined right now. The slug is the epic's immutable
 * git-safe identity, which is what the branch name is composed from, so the URL and the branch stay in
 * step by construction.
 *
 * <p><b>Which tab is open rides in `?tab=`, not in a trailing segment.</b> A trailing segment would
 * make a tab switch free (Angular reuses a component across a parameter change) and would make an
 * *epic* switch free too — which is the bug, not the feature: the page would keep showing the previous
 * epic's workspace. Keeping the tab in the query string leaves the path meaning "which epic", makes a
 * bare URL mean "no tab pinned" by simple absence, and keeps every tab a shareable link.
 *
 * <p>All twelve load eagerly. There are twelve of them, they share every component below them, and
 * a lazy chunk boundary here would be ceremony that costs a round trip.
 *
 * <p>The `**` route sits *inside* the layout: this application is served at the root of its own
 * host, so an unknown URL here is an ordinary 404 and is drawn with the chrome around it.
 */
export const routes: Routes = [
  {
    path: '',
    component: QitsMainLayout,
    children: [
      { path: '', component: LandingPage },
      { path: ':project', component: ProjectPage },
      { path: ':project/project-setup', component: ProjectSetupPage },
      { path: ':project/epics', component: EpicsPage },
      { path: ':project/release-requests', component: ProjectReleaseRequestsPage },
      { path: ':project/epics/:epicSlug/refining', component: RefiningPage },
      { path: ':project/repositories/new', component: CreateRepositoryPage },
      {
        path: ':project/:group/:repository',
        canMatch: [repositoryGroupIsKnown],
        component: RepositoryPage,
      },
      {
        path: ':project/:group/:repository/api-docs',
        canMatch: [repositoryGroupIsKnown],
        component: RepositoryApiDocsPage,
      },
      {
        path: ':project/:group/:repository/release-requests',
        canMatch: [repositoryGroupIsKnown],
        component: RepositoryReleaseRequestsPage,
      },
      {
        path: ':project/:group/:repository/release-requests/:requestId',
        canMatch: [repositoryGroupIsKnown],
        component: ReleaseRequestDetailPage,
      },
      { path: '**', component: NotFound },
    ],
  },
];

/**
 * The literal words this application routes for itself directly below `:project` — today
 * `project-setup`, `epics` and `repositories`.
 *
 * <p>**Derived from the table above, never listed twice.** It is what {@link repositoryGroupIsKnown}
 * inverts, so a second copy would be a list that silently stops matching the routes it is about,
 * and the symptom would be an address quietly resolving to the wrong page.
 *
 * <p>Declared *after* the table on purpose: the guard reads it when a navigation happens, long
 * after this module has finished evaluating.
 */
export const OWN_PROJECT_SEGMENTS: ReadonlySet<string> = new Set(
  (routes[0].children ?? [])
    .map((route) => (route.path ?? '').split('/'))
    .filter((parts) => parts[0] === ':project' && parts.length > 1)
    .map((parts) => parts[1])
    .filter((segment) => !segment.startsWith(':')),
);
