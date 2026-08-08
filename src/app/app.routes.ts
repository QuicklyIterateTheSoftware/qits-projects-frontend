import type { Routes } from '@angular/router';
import { QitsMainLayout } from '@qits/ui-components';
import { CreateRepositoryPage } from './create/create-repository-page';
import { LandingPage } from './landing/landing-page';
import { NotFound } from './not-found/not-found';
import { ProjectPage } from './project/project-page';
import { ProjectSetupPage } from './project/project-setup-page';
import { RefiningPage } from './refining/refining-page';

/**
 * Six routes, all of them inside the platform chrome.
 *
 * `QitsMainLayout` is the root *route* component rather than something the shell templates, so the
 * bar, the navigation and the project picker hanging under it mount once and survive every
 * navigation beneath them; only the outlet's content changes.
 *
 * <p><b>The project id is the first segment, with no collection segment above it.</b>
 * `/projects/<projectId>`, not `/projects/projects/<projectId>`: the gateway already spent a
 * segment saying which application this is, and spending a second one repeating it would put the
 * word twice in every URL a person is asked to read. It also makes the id trivially recoverable
 * from `router.url` for the sub-navigation, which lives above every `ActivatedRoute` there is.
 *
 * <p>`?type=` on the create page is a **prefill, not an address**: it seeds the archetype picker,
 * the picker is free to disagree with it, and a create page reached from a group's "New service"
 * link and one reached from the sub-menu are the same page. That is view state, so it is a query
 * parameter and not a segment.
 *
 * <p><b>`project-setup` is a segment because setting a project up is rare.</b> The project's own
 * address used to carry the component groups and the reconcile, which made the page a reader
 * arrives at most often the page they need least. Splitting them puts configuration one deliberate
 * click away and leaves `:projectId` free for what a project is mostly for. It is a path segment
 * rather than a query parameter because it is a different *place*, not a view of the same one.
 *
 * <p>Repository **detail is deliberately absent**. Every card on the setup page is therefore inert
 * rather than linking somewhere unbuilt — a dead link is worse than no link.
 *
 * <p><b>The refining route names an epic and never a workspace.</b>
 * `:projectId/epics/:epicSlug/refining` is where an epic is worked out, and the workspace behind it is
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
 * <p>All six load eagerly. There are six of them, they share every component below them, and a lazy
 * chunk boundary here would be ceremony that costs a round trip.
 *
 * <p>The `**` route sits *inside* the layout, unlike spa-home's. spa-home is mounted at the gateway
 * root, where an unrecognised first segment belongs to another application and has to be handed
 * back; `/projects/` is a segment this application owns outright, so an unknown URL under it is an
 * ordinary 404 and is drawn with the chrome around it.
 */
export const routes: Routes = [
  {
    path: '',
    component: QitsMainLayout,
    children: [
      { path: '', component: LandingPage },
      { path: ':projectId', component: ProjectPage },
      { path: ':projectId/project-setup', component: ProjectSetupPage },
      { path: ':projectId/epics/:epicSlug/refining', component: RefiningPage },
      { path: ':projectId/repositories/new', component: CreateRepositoryPage },
      { path: '**', component: NotFound },
    ],
  },
];
