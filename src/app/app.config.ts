import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { provideQitsNavigation, provideQitsProjects, provideQitsScope } from '@qits/ui-components';

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
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withFetch()),
    provideQitsNavigation(),
    provideQitsProjects(),
    provideQitsScope('repository'),
  ],
};
