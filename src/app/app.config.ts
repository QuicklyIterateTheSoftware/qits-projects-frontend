import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { provideQitsNavigation } from '@qits/ui-components';

import { routes } from './app.routes';

// `provideQitsNavigation` fills the shared layout's sidebar: one `GET /main-navigation` at startup,
// answered by the gateway from the routes it actually serves. The door list is a deployment fact
// now, not a list compiled into `@qits/ui-components`. It needs an `HttpClient`, which this app had
// no reason to provide until now.
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withFetch()),
    provideQitsNavigation(),
  ],
};
