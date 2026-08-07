import type { Routes } from '@angular/router';
import { QitsMainLayout } from '@qits/ui-components';
import { CreateRepositoryPage } from './create/create-repository-page';
import { LandingPage } from './landing/landing-page';
import { NotFound } from './not-found/not-found';
import { ProjectPage } from './project/project-page';

/**
 * Four routes, all of them inside the platform chrome.
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
 * <p>Repository **detail is deliberately absent**. Every card on the project page is therefore
 * inert rather than linking somewhere unbuilt — a dead link is worse than no link.
 *
 * <p>All four load eagerly. There are four of them, they share every component below them, and a
 * lazy chunk boundary here would be ceremony that costs a round trip.
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
      { path: ':projectId/repositories/new', component: CreateRepositoryPage },
      { path: '**', component: NotFound },
    ],
  },
];
