import { inject } from '@angular/core';
import { Router, type CanMatchFn, type RedirectFunction, type Routes } from '@angular/router';
import { QITS_CATEGORIES, QitsMainLayout, type QitsCategory } from '@qits/ui-components';
import { AgentMcpCatalogPage } from './agent-config/agent-mcp-catalog-page';
import { AgentSurfacePage } from './agent-config/agent-surface-page';
import { AgentSurfaceSkillsPage } from './agent-config/agent-surface-skills-page';
import { AgentSurfacesPage } from './agent-config/agent-surfaces-page';
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
import { RepositoryApiDocsPage } from './project/repository-api-docs-page';
import { RepositoryPage } from './project/repository-page';
import { RepositoryReleaseRequestsPage } from './project/repository-release-requests-page';
import { WorkPage } from './project/work-page';
import { RefiningPage } from './refining/refining-page';

/**
 * Whether the second segment of `/<project>/<group>/<repository>` names a group.
 *
 * <p>Without it every three-segment address in the application would be a repository. The test used
 * to be one set membership, because the group was always one of the archetype categories. A
 * repository is addressed by its **component** now, and component names are an *open* set only the
 * platform knows — so a closed test cannot prove one, and the question has to be asked the other
 * way round: **a segment is a group unless this application has claimed the word for itself.** The
 * categories the chrome knows still answer on their own, which keeps every archetype address
 * reading before any list has arrived.
 *
 * <p><b>`apps` is what proved the rule.</b> This application learned the word a release before
 * `@qits/ui-components` did, and the address read correctly the whole time — through the second
 * branch, as an unclaimed word, exactly as a component name does — with no special case anywhere.
 * Now that the chrome knows it, `QITS_CATEGORIES` answers for it on the first branch instead, and
 * nothing here changed to make that happen. The next word the two lists learn out of order gets the
 * same free ride.
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
 * The redirect from an old desk address to the one desk, with the archetype filter set and any other
 * query parameter carried along. A function rather than a string, because the filter is a query
 * parameter and a string redirect would have to spell it into a path.
 */
function toDesk(archetype: string): RedirectFunction {
  return ({ params, queryParams }) =>
    inject(Router).createUrlTree(['/', params['project'], 'work'], {
      queryParams: { ...queryParams, archetype: archetype.toLowerCase() },
    });
}

/**
 * The routes, all of them inside the platform chrome.
 *
 * <p><b>`agent-configuration` is the one word this application claims at the TOP level</b>, and it is
 * there because what it configures is platform-wide rather than a project's: one configuration per
 * *session surface* for the whole estate. Hanging it under `:project` would say the opposite of what
 * the store does, and per-project overrides are deliberately a later epic rather than a smaller
 * version of this one. The cost is the same one `''` already carries — a project whose slug were
 * `agent-configuration` would be shadowed, because Angular matches in order and the literal is above
 * `:project`. It is not in {@link OWN_PROJECT_SEGMENTS}, which is about words *below* a project and
 * derives itself from the table, so the group guard is untouched.
 *
 * <p>Its children spell the shape of the store: `surfaces/:surface` is one surface's whole
 * configuration, `surfaces/:surface/skills` is the reserved and empty place per-surface skills will
 * live, and `mcp-catalog` is the external MCP server catalog — a sibling and not a child, because a
 * catalog entry is defined once platform-wide and attached from many surfaces.
 *
 * <p><b>None of the four is guarded on the client.</b> The store's doors take `qits:admin` and this
 * application guards no route anywhere; the gateway session is what the browser carries and the
 * service is the only thing that can decide, so each page renders the 403 as a sentence rather than
 * a second copy of a decision it cannot make.
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
 * <p><b>`:project` is a hub and `:project/work` is the one desk</b> (qits-397, ticket 521a0bda). Every
 * epic and every ticket of the project is on that one page, and the archetype is a **filter** on it —
 * `?archetype=epic`, `?archetype=ticket` — never a second route and never a tab that is a route. It
 * replaced `:project/epics` and `:project/tickets`, which were two routes over one collection.
 *
 * <p><b>`:project/work/:number` is one node</b>, of any archetype — an epic, a ticket, and for the
 * first time a feature or a task — addressed by its **qualified number**, `qits-1337` (the bare
 * `1337` reads too). The number is stable for the entity's life and is what a person writes in a
 * commit subject, where a slug is only unique within one archetype. **The literal `work` segment is
 * load-bearing**: `:project/:group/:repository` and `:project/project-setup` are live addresses, so a
 * node can never be `:project/:number` — a two-segment number would collide with the project's own
 * words and a three-segment one with a repository. `:project/work/:number/refinement` is that node's
 * refinement room, for an epic or a ticket (qits-395).
 *
 * <p><b>The old shapes keep working, cheaply.</b> `:project/epics` and `:project/tickets` redirect to
 * the desk with the filter set; `:project/tickets/:ticket` and `:project/epics/:epicSlug/refining`
 * name a slug, which only a read can turn into a number, so they route to
 * {@link EntitySlugResolver}, which replaces itself with the numbered address. All four stay in the
 * table, so `epics` and `tickets` stay {@link OWN_PROJECT_SEGMENTS} words and the guard keeps refusing
 * them as repository groups.
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
 * <p><b>`:project/release-requests/by-release/:repoId/:version` is not a page.</b> It is the address
 * a link from a *release* lands on — qits-platform-maintenance knows a repository and a version and
 * never the request's id, which is minted here — and it resolves the pair and replaces itself with
 * the five-segment address above. It sits with the project's own literals and **above** the guarded
 * routes, which is where every literal below `:project` has to be; `release-requests` is already an
 * {@link OWN_PROJECT_SEGMENTS} word, so nothing about the guard changes by adding it.
 *
 * <p><b>`:project/release-requests/:requestId` is one request on the PROJECT's own repository</b>,
 * and it is a second address for the same page rather than a second page. The five-segment form
 * names a repository by group and name, and the project's wrapper has neither: `PROJECT` is
 * deliberately unplaceable — it *is* the tree, so it is in no component and in no archetype category
 * — and every five-segment address for it would have to invent a group and say the wrapper is a
 * service. The wrapper is the project, so the project's own address is the honest one, and what is
 * released at it is the declaration of which commit of every component this project is made of.
 *
 * <p><b>The order of the two `release-requests` routes below `:project` is load-bearing</b>, and
 * `by-release` is declared first for that reason. Angular tries this table top to bottom and a leaf
 * route must consume the whole address, so today the four-segment `by-release/:repoId/:version` and
 * this two-segment `:requestId` cannot be confused by segment count alone — but that is a property
 * of both being leaves, which the first child route added under either would quietly remove, and the
 * failure would be `by-release` resolving as a request whose id is the word `by-release`. Declaring
 * the more specific literal above the parameter is what keeps that from depending on a coincidence.
 * The list at `:project/release-requests` is one segment shorter again and is declared above both.
 *
 * <p>Nothing about {@link OWN_PROJECT_SEGMENTS} moves: the set is derived from this table's
 * `:project/<literal>` heads, and `release-requests` was already one of them.
 *
 * <p><b>The refinement route names an entity and never a room.</b>
 * `:project/work/:number/refinement` is where an epic or a ticket is worked out, and the room behind it
 * is *looked up* by the entity it names. Nothing about a room belongs in an address: a room's row id
 * rots the moment the room is discarded and another opened, while the entity's number does not.
 *
 * <p><b>Which tab is open rides in `?tab=`, not in a trailing segment.</b> A trailing segment would
 * make a tab switch free (Angular reuses a component across a parameter change) and would make an
 * *entity* switch free too — which is the bug, not the feature: the page would keep showing the
 * previous entity's room. Keeping the tab in the query string leaves the path meaning "which epic", makes a
 * bare URL mean "no tab pinned" by simple absence, and keeps every tab a shareable link.
 *
 * <p>They all load eagerly: they share every component below them, and a lazy chunk boundary here
 * would be ceremony that costs a round trip.
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
      { path: 'agent-configuration', component: AgentSurfacesPage },
      { path: 'agent-configuration/mcp-catalog', component: AgentMcpCatalogPage },
      { path: 'agent-configuration/surfaces/:surface', component: AgentSurfacePage },
      {
        path: 'agent-configuration/surfaces/:surface/skills',
        component: AgentSurfaceSkillsPage,
      },
      { path: ':project', component: ProjectPage },
      { path: ':project/project-setup', component: ProjectSetupPage },
      { path: ':project/work', component: WorkPage },
      { path: ':project/work/:number', component: EntityDetailPage },
      { path: ':project/work/:number/refinement', component: RefiningPage },
      { path: ':project/epics', pathMatch: 'full', redirectTo: toDesk('EPIC') },
      { path: ':project/tickets', pathMatch: 'full', redirectTo: toDesk('TICKET') },
      {
        path: ':project/tickets/:ticket',
        component: EntitySlugResolver,
        data: { archetype: 'TICKET' },
      },
      { path: ':project/release-requests', component: ProjectReleaseRequestsPage },
      {
        path: ':project/release-requests/by-release/:repoId/:version',
        component: ReleaseRequestByReleaseResolver,
      },
      { path: ':project/release-requests/:requestId', component: ReleaseRequestDetailPage },
      {
        path: ':project/epics/:epicSlug/refining',
        component: EntitySlugResolver,
        data: { archetype: 'EPIC', room: true },
      },
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
 * `project-setup`, `work`, `epics`, `tickets`, `release-requests` and `repositories`.
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
