import type { CanMatchFn, Routes } from '@angular/router';
import { QITS_CATEGORIES, QitsMainLayout, type QitsCategory } from '@qits/ui-components';
import { CreateRepositoryPage } from './create/create-repository-page';
import { LandingPage } from './landing/landing-page';
import { NotFound } from './not-found/not-found';
import { ProjectPage } from './project/project-page';
import { ProjectSetupPage } from './project/project-setup-page';
import { RepositoryApiDocsPage } from './project/repository-api-docs-page';
import { RepositoryPage } from './project/repository-page';
import { RefiningPage } from './refining/refining-page';

/**
 * Whether the second segment of `/<project>/<category>/<repository>` names one of the six
 * categories.
 *
 * <p>Without it every three-segment address in the application would be a repository:
 * `/qits/epics/planning` would resolve to the repository page and draw a repository nobody has.
 * The category vocabulary is closed and shared platform-wide, so the guard is a set membership and
 * not a lookup — no request, no async, and the same answer in a spec as in the browser.
 *
 * <p>`segments` is what is left *below* this route, so segment 0 is the project and segment 1 the
 * category.
 */
export const categoryIsKnown: CanMatchFn = (_route, segments) =>
  QITS_CATEGORIES.includes(segments[1]?.path as QitsCategory);

/**
 * Eight routes, all of them inside the platform chrome.
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
 * <p><b>`:project/:category/:repository` is the repository detail</b>, the address every other SPA
 * on the platform also serves — so the sidebar's per-repository entries and this page's cards are
 * the same URL with a different host in front. It is guarded on the category, which is what keeps
 * it from swallowing every three-segment address; the literal routes above it win regardless,
 * because Angular matches in order.
 *
 * <p><b>`:project/:category/:repository/api-docs` is a view of that repository</b> — the address
 * this application's own `services.details.Api Docs:6=api-docs` navigation entry composes. Same
 * guard, for the same reason: the fourth segment does not make `/qits/epics/planning/api-docs` a
 * repository.
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
 * <p>All eight load eagerly. There are eight of them, they share every component below them, and a
 * lazy chunk boundary here would be ceremony that costs a round trip.
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
      { path: ':project/epics/:epicSlug/refining', component: RefiningPage },
      { path: ':project/repositories/new', component: CreateRepositoryPage },
      {
        path: ':project/:category/:repository',
        canMatch: [categoryIsKnown],
        component: RepositoryPage,
      },
      {
        path: ':project/:category/:repository/api-docs',
        canMatch: [categoryIsKnown],
        component: RepositoryApiDocsPage,
      },
      { path: '**', component: NotFound },
    ],
  },
];
