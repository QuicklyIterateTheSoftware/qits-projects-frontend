import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import {
  QITS_PROJECT_SCOPE,
  provideQitsNavigation,
  provideQitsProjects,
} from '@qits/ui-components';

import { routes } from './app.routes';
import { ProjectRouteScope } from './nav/project-route-scope';

// `provideQitsNavigation` fills the shared layout's sidebar: one `GET /main-navigation` at startup,
// answered by the gateway from the routes it actually serves. The door list is a deployment fact
// now, not a list compiled into `@qits/ui-components`. It needs an `HttpClient`, which this app had
// no reason to provide until now.
//
// `provideQitsProjects` puts the project picker in the chrome's top-left slot, from one
// `GET /projects/api/projects`. That is the same list this app's own `ProjectsApi` reads, and the
// duplicate request is deliberate: the chrome is the library's, it renders in every SPA, and giving
// it a seam into this app's store would make the shared layout depend on one application's cache.
//
// `QITS_PROJECT_SCOPE` is overridden *after* it, which is the whole point of the ordering: the
// library's default carries the pick in `?project=`, and here the project id is the first path
// segment, so `ProjectRouteScope` answers from the URL this app already writes.
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withFetch()),
    provideQitsNavigation(),
    provideQitsProjects(),
    { provide: QITS_PROJECT_SCOPE, useExisting: ProjectRouteScope },
  ],
};
