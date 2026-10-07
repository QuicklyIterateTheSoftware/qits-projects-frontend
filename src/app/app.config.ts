import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import {
  provideQitsBuilds,
  provideQitsNavigation,
  provideQitsProjects,
  provideQitsScope,
  provideQitsStandardReportKinds,
} from '@qits/ui-components';

import { routes } from './app.routes';

// `provideQitsNavigation` fills the shared layout's sidebar: one `GET /main-navigation` at startup,
// answered by the edge from the deployments it actually serves — a nested tree of slots now, not a
// flat list of doors. It needs an `HttpClient`.
//
// `provideQitsProjects` puts the project picker in the chrome's top-left slot, from one
// `GET /projects/api/projects`, and installs the scoped project's repositories beside it. That is
// the same list this app's own `ProjectsStore` reads, and the duplicate request is deliberate: the
// chrome is the library's, it renders in every SPA, and giving it a seam into this app's cache
// would make the shared layout depend on one application's store.
//
// `provideQitsScope('repository')` says how deep this application's own addresses go: it serves
// `/<slug>/<category>/<repoName>` as well as `/<slug>`, so a pick in the picker navigates here
// rather than leaving for another host. Every SPA declares its own kind — the library installs
// none.
//
// `provideQitsBuilds` puts the pending-builds bolt beside the picker: a popover of what qits-ci is
// building right now, from `GET /ci/api/runs/active` on qits-ci's own origin, which the library
// reads from the navigation — the edge routes `/ci` on qits-ci's host only — so it needs the
// `HttpClient` too and this app composes no hostname. Providing it is what puts the bolt there,
// exactly as no project source means no picker. Closed, it asks nothing at all; it polls only for
// as long as a reader keeps the panel open.
//
// `provideQitsStandardReportKinds` registers the two first report kinds' views — `test-results` and
// `coverage` — with `<qits-run-reports>`, the generic report area the release request detail page
// hosts for the QA run. Without it the area would still draw every highlight, but a section opened
// on either kind would fall back to "no view for this report kind here". It also installs
// `provideQitsStandardFailureInsights()` (qits-755), so opening a located failure in the
// `test-results` section draws its test code, read from qits-githost.
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withFetch()),
    provideQitsNavigation(),
    provideQitsProjects(),
    provideQitsScope('repository'),
    provideQitsBuilds(),
    provideQitsStandardReportKinds(),
  ],
};
