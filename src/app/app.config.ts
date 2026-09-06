import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import {
  provideQitsBuilds,
  provideQitsNavigation,
  provideQitsProjects,
  provideQitsScope,
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
// building right now, from `GET /ci/api/runs/active`. Same-origin like the two reads above — the
// edge routes `/ci` on every host — so it needs the `HttpClient` too and names no origin of its
// own. Providing it is what puts the bolt there, exactly as no project source means no picker.
// Closed, it asks nothing at all; it polls only for as long as a reader keeps the panel open.
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withFetch()),
    provideQitsNavigation(),
    provideQitsProjects(),
    provideQitsScope('repository'),
    provideQitsBuilds(),
  ],
};
